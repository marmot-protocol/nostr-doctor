import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { mapEventsToStore } from "applesauce-core";
import {
  relaySet,
  type EventTemplate,
  type NostrEvent,
} from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { use$ } from "applesauce-react/hooks";
import type { Relay } from "applesauce-relay";
import { useEffect, useMemo, useState } from "react";
import { of, timeout, timer } from "rxjs";
import { catchError, last, map, take, takeUntil } from "rxjs/operators";
import { useReport } from "../../context/ReportContext.tsx";
import { factory } from "../../lib/factory.ts";
import { DEFAULT_RELAYS, LOOKUP_RELAYS, pool } from "../../lib/relay.ts";
import { eventStore } from "../../lib/store.ts";
import {
  AUTO_ADVANCE_MS,
  EVENT_LOAD_TIMEOUT_MS,
  VERDICT_TIMEOUT_MS,
} from "../../lib/timeouts.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ms to wait for the per-relay auth probe before treating the relay as unknown */
const PROBE_TIMEOUT_MS = 10_000;

/** Relays used to fetch the kind:10050 event */
const FETCH_RELAYS = relaySet(LOOKUP_RELAYS, DEFAULT_RELAYS);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-relay auth probe result */
type AuthStatus = "checking" | "protected" | "unprotected" | "unknown";

// ---------------------------------------------------------------------------
// useAuthStatus
//
// Probes a single relay by sending a REQ for kind:1059 p-tagged to the subject.
// Monitors relay.authRequiredForRead$ in parallel.
//
// - "protected"   — relay demanded auth-required in response to our REQ
// - "unprotected" — relay served EOSE without requiring auth
// - "unknown"     — relay did not respond within PROBE_TIMEOUT_MS
// ---------------------------------------------------------------------------

function useAuthStatus(relay: Relay, subjectPubkey: string): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    let settled = false;

    function settle(next: AuthStatus) {
      if (settled) return;
      settled = true;
      setStatus(next);
    }

    // Watch authRequiredForRead$ — flips to true when relay sends CLOSED with
    // "auth-required: ..." in response to our REQ below.
    const authSub = relay.authRequiredForRead$.subscribe((required) => {
      if (required) settle("protected");
    });

    // Send the probe REQ: kind:1059 p-tagged to the subject, limit 1.
    // We use relay.req() (low-level, no auto-retry/auto-auth) so we see the
    // raw unauthenticated relay response.
    const reqSub = relay
      .req({ kinds: [1059], "#p": [subjectPubkey], limit: 1 })
      .pipe(
        // Cap the probe at PROBE_TIMEOUT_MS
        timeout({
          first: PROBE_TIMEOUT_MS,
          with: () => of("timeout" as const),
        }),
        // Convert any error (ReqCloseError with auth-required prefix, or
        // connection error) into a terminal "error" signal so we can inspect
        // the authRequiredForRead$ state after the fact.
        catchError(() => of("error" as const)),
        take(1),
      )
      .subscribe((result) => {
        if (result === "timeout") {
          settle("unknown");
        } else if (result === "error") {
          // authSub may have already flipped us to "protected" via the
          // CLOSED message that caused this error. If not, it's unknown.
          settle("unknown");
        } else {
          // result is "EOSE" or a NostrEvent — relay served without auth
          settle("unprotected");
        }
      });

    return () => {
      authSub.unsubscribe();
      reqSub.unsubscribe();
    };
  }, [relay, subjectPubkey]);

  return status;
}

// ---------------------------------------------------------------------------
// AuthBadge
// ---------------------------------------------------------------------------

function AuthBadge({ status }: { status: AuthStatus }) {
  if (status === "protected") {
    return (
      <span className="badge badge-success badge-sm whitespace-nowrap">
        Auth Required
      </span>
    );
  }
  if (status === "unprotected") {
    return (
      <span className="badge badge-error badge-sm whitespace-nowrap">
        No Auth
      </span>
    );
  }
  if (status === "unknown") {
    return (
      <span className="badge badge-ghost badge-sm whitespace-nowrap">
        Unknown
      </span>
    );
  }
  return (
    <span className="badge badge-ghost badge-sm gap-1 whitespace-nowrap">
      <span className="loading loading-spinner loading-xs" />
      Checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — single DM relay with auth badge and optional checkbox
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  relay,
  status,
  selected,
  onToggle,
}: {
  relayUrl: string;
  relay: Relay;
  status: AuthStatus;
  selected: boolean;
  onToggle: (url: string) => void;
}) {
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isUnprotected = status === "unprotected";

  const name = info?.name ?? relayUrl;
  const description = info?.description;

  return (
    <label
      className={[
        "rounded-xl border p-4 flex items-start gap-3 transition-colors select-none",
        isUnprotected ? "cursor-pointer" : "cursor-default",
        isUnprotected
          ? selected
            ? "border-error/60 bg-error/10"
            : "border-error/30 bg-error/5"
          : "border-base-200",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Checkbox — only interactive for unprotected relays */}
      {isUnprotected ? (
        <input
          type="checkbox"
          className="checkbox checkbox-error checkbox-sm mt-0.5 shrink-0"
          checked={selected}
          onChange={() => onToggle(relayUrl)}
        />
      ) : (
        <div className="size-4 mt-0.5 shrink-0" />
      )}

      {/* Icon */}
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="size-8 rounded-lg shrink-0 object-cover bg-base-200"
        />
      ) : (
        <div
          className="size-8 rounded-lg shrink-0 bg-base-200 flex items-center justify-center text-base-content/40 text-xs font-mono"
          aria-hidden
        >
          …
        </div>
      )}

      {/* Text */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-medium text-sm text-base-content truncate">
          {name}
        </span>
        <span className="font-mono text-xs text-base-content/60 break-all">
          {relayUrl}
        </span>
        {description != null && description !== "" && (
          <p className="text-xs text-base-content/70 line-clamp-2 mt-0.5">
            {description}
          </p>
        )}
      </div>

      {/* Badge */}
      <AuthBadge status={status} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// StatusTracker — wraps RelayRow and bubbles status changes upward
// ---------------------------------------------------------------------------

function StatusTracker({
  relayUrl,
  relay,
  selected,
  subjectPubkey,
  onToggle,
  onStatus,
}: {
  relayUrl: string;
  relay: Relay;
  selected: boolean;
  subjectPubkey: string;
  onToggle: (url: string) => void;
  onStatus: (url: string, status: AuthStatus) => void;
}) {
  const status = useAuthStatus(relay, subjectPubkey);

  useEffect(() => {
    onStatus(relayUrl, status);
  }, [relayUrl, status, onStatus]);

  return (
    <RelayRow
      relayUrl={relayUrl}
      relay={relay}
      status={status}
      selected={selected}
      onToggle={onToggle}
    />
  );
}

// ---------------------------------------------------------------------------
// Main page — DmRelayAuth
// ---------------------------------------------------------------------------

function DmRelayAuth() {
  const { subject: subjectUser, next, publish: publishEvent } = useReport();

  // -------------------------------------------------------------------------
  // Fetch kind:10050 DM relay list
  // Use the subject's outboxes as primary relays, fall back to FETCH_RELAYS.
  // Resolves to null after EVENT_LOAD_TIMEOUT_MS if the event never arrives.
  // -------------------------------------------------------------------------

  const outboxes = use$(() => subjectUser?.outboxes$, [subjectUser]);

  const dmRelaysCast = use$(
    () =>
      subjectUser
        ? pool
            .request(relaySet(outboxes, FETCH_RELAYS), {
              authors: [subjectUser.pubkey],
              kinds: [10050],
              limit: 1,
            })
            .pipe(
              mapEventsToStore(eventStore),
              takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
              last(null, null as NostrEvent | null),
              map((event) => (event ? getRelaysFromList(event) : null)),
            )
        : undefined,
    [subjectUser?.pubkey, outboxes?.join(",")],
  );

  const listLoaded = dmRelaysCast !== undefined;
  const listNotFound = dmRelaysCast === null;

  const relayList = useMemo<string[]>(() => dmRelaysCast ?? [], [dmRelaysCast]);

  const relayEntries = useMemo(
    () => relayList.map((url) => ({ url, relay: pool.relay(url) })),
    [relayList],
  );

  // -------------------------------------------------------------------------
  // Per-relay auth status tracking
  // -------------------------------------------------------------------------

  const [statuses, setStatuses] = useState<Record<string, AuthStatus>>({});

  const handleStatus = useMemo(
    () => (url: string, status: AuthStatus) =>
      setStatuses((prev) =>
        prev[url] === status ? prev : { ...prev, [url]: status },
      ),
    [],
  );

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  // Timeout for probe completion — after VERDICT_TIMEOUT_MS treat remaining
  // "checking" statuses as unknown and allow proceeding.
  const [checkTimedOut, setCheckTimedOut] = useState(false);
  useEffect(() => {
    if (!listLoaded || relayList.length === 0) return;
    const timer = setTimeout(() => setCheckTimedOut(true), VERDICT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [listLoaded, relayList.length]);

  const unprotectedUrls = useMemo(
    () => relayList.filter((url) => statuses[url] === "unprotected"),
    [relayList, statuses],
  );

  const allChecked = useMemo(
    () =>
      relayList.every(
        (url) => statuses[url] !== undefined && statuses[url] !== "checking",
      ),
    [relayList, statuses],
  );

  const allProtected = useMemo(
    () =>
      listLoaded &&
      !listNotFound &&
      relayList.length > 0 &&
      (allChecked || checkTimedOut) &&
      unprotectedUrls.length === 0,
    [
      listLoaded,
      listNotFound,
      relayList.length,
      allChecked,
      checkTimedOut,
      unprotectedUrls.length,
    ],
  );

  const canProceed = allChecked || checkTimedOut;

  // -------------------------------------------------------------------------
  // Checkbox selection for unprotected relays
  // -------------------------------------------------------------------------

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Auto-select all unprotected relays when they are first discovered
  useEffect(() => {
    if (unprotectedUrls.length > 0) {
      setSelected(new Set(unprotectedUrls));
    }
  }, [unprotectedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }

  function handleSelectAll() {
    setSelected(new Set(unprotectedUrls));
  }

  function handleDeselectAll() {
    setSelected(new Set());
  }

  // -------------------------------------------------------------------------
  // Publish state
  // -------------------------------------------------------------------------

  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Auto-advance
  // -------------------------------------------------------------------------

  // All relays are protected — auto-advance
  useEffect(() => {
    if (allProtected) {
      const timer = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [allProtected, next]);

  // Removals published — auto-advance
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [done, next]);

  // -------------------------------------------------------------------------
  // Remove handler
  // -------------------------------------------------------------------------

  async function handleRemoveSelected() {
    if (!subjectUser || selected.size === 0) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(10050, subjectUser.pubkey);
      if (!existing)
        throw new Error(
          "Could not find your DM relay list event (kind:10050).",
        );
      const tagOps = [...selected].map((url) => removeRelayTag(url));
      const draft: EventTemplate = await factory.modify(
        existing,
        modifyPublicTags(...tagOps),
      );
      await publishEvent(draft);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update DM relay list.",
      );
    } finally {
      setPublishing(false);
    }
  }

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (!listLoaded) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your DM relay list…
            </p>
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not found — kind:10050 timed out or does not exist
  // -------------------------------------------------------------------------

  if (listNotFound) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                DM Relays
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                No DM relay list found
              </h1>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
              No NIP-17 DM relay list (kind:10050) could be found for this
              account. Without one, senders won't know where to deliver your
              encrypted messages.
            </div>
            <button className="btn btn-outline btn-sm w-full" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Empty list — kind:10050 exists but has no relays
  // -------------------------------------------------------------------------

  if (relayList.length === 0) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                DM Relays
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                DM relay list is empty
              </h1>
            </div>
            <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
              Your kind:10050 DM relay list exists but contains no relays.
            </div>
            <button className="btn btn-outline btn-sm w-full" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // All-clear — every relay requires auth (auto-advancing)
  // -------------------------------------------------------------------------

  if (allProtected) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <svg
                className="size-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-base-content">
                All DM relays require auth
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                All {relayList.length} DM{" "}
                {relayList.length === 1 ? "relay requires" : "relays require"}{" "}
                NIP-42 authentication to read gift wraps. Your messages are
                protected.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Done — removals published (auto-advancing)
  // -------------------------------------------------------------------------

  if (done) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <svg
                className="size-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-base-content">
                DM relay list updated
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                Your updated DM relay list has been published.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main view
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              DM Relays
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              NIP-42 Auth Protection
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              Checking whether your DM relays require NIP-42 authentication to
              read gift wrap events. Relays that don't enforce auth expose your
              message metadata to anyone.
            </p>
          </div>

          {/* Relay list */}
          <div className="flex flex-col gap-3">
            {subjectUser &&
              relayEntries.map(({ url, relay }) => (
                <StatusTracker
                  key={url}
                  relayUrl={url}
                  relay={relay}
                  selected={selected.has(url)}
                  subjectPubkey={subjectUser.pubkey}
                  onToggle={handleToggle}
                  onStatus={handleStatus}
                />
              ))}
          </div>

          {/* Unprotected callout with select-all controls */}
          {unprotectedUrls.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-sm text-warning">
                {unprotectedUrls.length}{" "}
                {unprotectedUrls.length === 1 ? "relay does" : "relays do"} not
                require authentication to read gift wraps. Anyone can query
                these relays for your encrypted messages. Consider removing them
                and replacing with auth-protected relays.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={handleSelectAll}
                  disabled={selected.size === unprotectedUrls.length}
                >
                  Select all
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={handleDeselectAll}
                  disabled={selected.size === 0}
                >
                  Deselect all
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {unprotectedUrls.length > 0 && (
              <button
                className="btn btn-error w-full"
                onClick={handleRemoveSelected}
                disabled={publishing || selected.size === 0}
              >
                {publishing ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : selected.size === 0 ? (
                  "No relays selected"
                ) : (
                  `Remove ${selected.size} selected ${selected.size === 1 ? "relay" : "relays"}`
                )}
              </button>
            )}
            <button
              className="btn btn-primary w-full"
              onClick={next}
              disabled={!canProceed || publishing}
            >
              {canProceed ? "Next" : "Checking…"}
            </button>
            {!canProceed && (
              <button
                className="btn btn-ghost btn-sm w-full"
                onClick={next}
                disabled={publishing}
              >
                Skip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DmRelayAuth;
