import { useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { EMPTY, timeout } from "rxjs";
import { useReport } from "../../context/ReportContext.tsx";
import { pool, LOOKUP_RELAYS } from "../../lib/relay.ts";

/** ms to wait for the kind:10002 outbox list before proceeding with LOOKUP_RELAYS only */
const OUTBOX_LOAD_TIMEOUT_MS = 8_000;
/** ms to wait per relay request before treating it as complete */
const RELAY_REQUEST_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Metadata kinds we check for
// ---------------------------------------------------------------------------

type KindEntry = {
  kind: number;
  label: string;
  description: string;
};

const METADATA_KINDS: KindEntry[] = [
  { kind: 0, label: "profile", description: "User Metadata (kind:0)" },
  { kind: 3, label: "follows", description: "Follow List (kind:3)" },
  { kind: 10002, label: "relays", description: "Relay List (kind:10002)" },
  {
    kind: 10050,
    label: "dm-relays",
    description: "DM Relay List (kind:10050)",
  },
  {
    kind: 10063,
    label: "servers",
    description: "Blossom Server List (kind:10063)",
  },
];

const ALL_KINDS = METADATA_KINDS.map((k) => k.kind);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events found: relayUrl -> kind -> event */
type RelayKindMap = Map<string, Map<number, NostrEvent>>;

type RelayCheckState = "pending" | "checking" | "done";

// ---------------------------------------------------------------------------
// KindBadge — shows status of one kind for one relay
// ---------------------------------------------------------------------------

function KindBadge({
  kindEntry,
  event,
  relayState,
}: {
  kindEntry: KindEntry;
  event: NostrEvent | undefined;
  relayState: RelayCheckState;
}) {
  const isChecking = relayState === "checking" && event === undefined;

  if (isChecking) {
    return (
      <span
        className="badge badge-ghost badge-xs gap-1 shrink-0"
        title={kindEntry.description}
      >
        <span
          className="loading loading-spinner loading-xs opacity-50"
          style={{ width: "8px", height: "8px" }}
        />
        {kindEntry.label}
      </span>
    );
  }

  if (event !== undefined) {
    return (
      <span
        className="badge badge-success badge-xs shrink-0"
        title={`${kindEntry.description} — found`}
      >
        {kindEntry.label}
      </span>
    );
  }

  // Done checking, not found
  return (
    <span
      className="badge badge-ghost badge-xs opacity-40 shrink-0"
      title={`${kindEntry.description} — not found`}
    >
      {kindEntry.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — one row per relay being checked
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  kindMap,
  checkState,
}: {
  relayUrl: string;
  kindMap: Map<number, NostrEvent> | undefined;
  checkState: RelayCheckState;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);

  const name = info?.name ?? relayUrl;
  const foundCount = kindMap?.size ?? 0;
  const isDone = checkState === "done";

  return (
    <div className="rounded-xl border border-base-200 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
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
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="font-medium text-sm text-base-content truncate">
            {name}
          </span>
          <span className="font-mono text-xs text-base-content/50 break-all">
            {relayUrl}
          </span>
        </div>
        {isDone && (
          <span className="text-xs text-base-content/40 shrink-0">
            {foundCount}/{METADATA_KINDS.length}
          </span>
        )}
        {checkState === "checking" && (
          <span className="loading loading-spinner loading-xs text-base-content/30 shrink-0" />
        )}
      </div>

      {/* Kind badges */}
      <div className="flex flex-wrap gap-1.5">
        {METADATA_KINDS.map((ke) => (
          <KindBadge
            key={ke.kind}
            kindEntry={ke}
            event={kindMap?.get(ke.kind)}
            relayState={checkState}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function MetadataBroadcast() {
  const { subject: subjectUser, next } = useReport();

  // ---------------------------------------------------------------------------
  // Step 1 — load outbox relays
  // ---------------------------------------------------------------------------
  const outboxes = use$(
    () =>
      subjectUser
        ? subjectUser.outboxes$.pipe(
            timeout({ first: OUTBOX_LOAD_TIMEOUT_MS, with: () => EMPTY }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  // undefined = still loading; string[] | null after EMPTY completes immediately = treat as []
  // EMPTY completes without emitting, so use$ will stay undefined until timeout fires
  // We track outboxes as loaded once it's no longer undefined or after timeout
  const outboxesLoaded = outboxes !== undefined;

  // After timeout, outboxes will be undefined still (EMPTY never emits).
  // We need a separate flag for "outbox phase done".
  const [outboxPhaseComplete, setOutboxPhaseComplete] = useState(false);

  useEffect(() => {
    if (!subjectUser) return;
    const timer = setTimeout(
      () => setOutboxPhaseComplete(true),
      OUTBOX_LOAD_TIMEOUT_MS + 100,
    );
    return () => clearTimeout(timer);
  }, [subjectUser]);

  // Mark outbox phase complete as soon as we have a real value
  useEffect(() => {
    if (outboxesLoaded) setOutboxPhaseComplete(true);
  }, [outboxesLoaded]);

  // ---------------------------------------------------------------------------
  // Relay list — union of outbox relays + LOOKUP_RELAYS
  // ---------------------------------------------------------------------------
  const allRelays = useMemo<string[]>(() => {
    const outboxList = Array.isArray(outboxes) ? outboxes : [];
    const combined = [...outboxList, ...LOOKUP_RELAYS];
    // Deduplicate, normalize trailing slash
    const seen = new Set<string>();
    return combined.filter((url) => {
      const norm = url.replace(/\/$/, "");
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });
  }, [outboxes]);

  // ---------------------------------------------------------------------------
  // Step 2 — per-relay fetch
  // ---------------------------------------------------------------------------

  /** Events found per relay per kind */
  const [relayKindMap, setRelayKindMap] = useState<RelayKindMap>(new Map());

  /** Check state per relay */
  const [relayStates, setRelayStates] = useState<Map<string, RelayCheckState>>(
    new Map(),
  );

  // Track which relay URLs we've already kicked off fetches for
  const fetchedRelays = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!outboxPhaseComplete || !subjectUser || allRelays.length === 0) return;

    const subscriptions: { unsubscribe: () => void }[] = [];

    for (const relayUrl of allRelays) {
      if (fetchedRelays.current.has(relayUrl)) continue;
      fetchedRelays.current.add(relayUrl);

      // Mark as checking
      setRelayStates((prev) => {
        const next = new Map(prev);
        next.set(relayUrl, "checking");
        return next;
      });

      const relay = pool.relay(relayUrl);
      const sub = relay
        .request({ kinds: ALL_KINDS, authors: [subjectUser.pubkey] })
        .pipe(timeout({ first: RELAY_REQUEST_TIMEOUT_MS, with: () => EMPTY }))
        .subscribe({
          next: (event) => {
            setRelayKindMap((prev) => {
              const next = new Map(prev);
              const kindMap = new Map(next.get(relayUrl) ?? []);
              // Keep highest created_at per kind
              const existing = kindMap.get(event.kind);
              if (
                existing === undefined ||
                event.created_at > existing.created_at
              ) {
                kindMap.set(event.kind, event);
              }
              next.set(relayUrl, kindMap);
              return next;
            });
          },
          complete: () => {
            setRelayStates((prev) => {
              const next = new Map(prev);
              next.set(relayUrl, "done");
              return next;
            });
          },
          error: () => {
            setRelayStates((prev) => {
              const next = new Map(prev);
              next.set(relayUrl, "done");
              return next;
            });
          },
        });

      subscriptions.push(sub);
    }

    return () => {
      for (const sub of subscriptions) sub.unsubscribe();
    };
  }, [outboxPhaseComplete, subjectUser, allRelays]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const allRelaysChecked = useMemo(() => {
    if (!outboxPhaseComplete || allRelays.length === 0) return false;
    return allRelays.every((url) => relayStates.get(url) === "done");
  }, [outboxPhaseComplete, allRelays, relayStates]);

  // Unique best events per kind (highest created_at across all relays)
  const bestEventsByKind = useMemo<Map<number, NostrEvent>>(() => {
    const result = new Map<number, NostrEvent>();
    for (const kindMap of relayKindMap.values()) {
      for (const [kind, event] of kindMap.entries()) {
        const existing = result.get(kind);
        if (existing === undefined || event.created_at > existing.created_at) {
          result.set(kind, event);
        }
      }
    }
    return result;
  }, [relayKindMap]);

  // All relays done and all kinds present everywhere — nothing to do
  const allKindsPresentEverywhere = useMemo(() => {
    if (!allRelaysChecked || allRelays.length === 0) return false;
    return allRelays.every((url) => {
      const kindMap = relayKindMap.get(url);
      return METADATA_KINDS.every((ke) => kindMap?.has(ke.kind));
    });
  }, [allRelaysChecked, allRelays, relayKindMap]);

  // ---------------------------------------------------------------------------
  // Broadcast
  // ---------------------------------------------------------------------------

  const [broadcasting, setBroadcasting] = useState(false);
  const [done, setDone] = useState(false);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  function handleBroadcast() {
    if (bestEventsByKind.size === 0) {
      next();
      return;
    }

    setBroadcasting(true);
    setBroadcastError(null);

    try {
      for (const event of bestEventsByKind.values()) {
        // Fire-and-forget: publish already-signed events to all checked relays
        void pool.publish(allRelays, event);
      }
      setDone(true);
    } catch (e) {
      setBroadcastError(e instanceof Error ? e.message : "Broadcast failed.");
    } finally {
      setBroadcasting(false);
    }
  }

  // Auto-advance after done
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [done, next]);

  // Auto-advance when all-clear (everything present on every relay)
  useEffect(() => {
    if (allKindsPresentEverywhere) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [allKindsPresentEverywhere, next]);

  // ---------------------------------------------------------------------------
  // Render: loading outboxes
  // ---------------------------------------------------------------------------
  if (!outboxPhaseComplete) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your relay list…
            </p>
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: all-clear (auto-advancing)
  // ---------------------------------------------------------------------------
  if (allKindsPresentEverywhere) {
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
                Metadata fully propagated
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                All metadata events are already present on every checked relay.
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

  // ---------------------------------------------------------------------------
  // Render: done broadcasting (auto-advancing)
  // ---------------------------------------------------------------------------
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
                Broadcast complete
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                {bestEventsByKind.size}{" "}
                {bestEventsByKind.size === 1 ? "event" : "events"} published to{" "}
                {allRelays.length} {allRelays.length === 1 ? "relay" : "relays"}
                .
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: main view — checking + broadcast
  // ---------------------------------------------------------------------------

  const checkingCount = allRelays.filter(
    (url) => relayStates.get(url) === "checking",
  ).length;
  const doneCount = allRelays.filter(
    (url) => relayStates.get(url) === "done",
  ).length;

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Metadata Broadcast
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              Relay Coverage
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              Checking {allRelays.length}{" "}
              {allRelays.length === 1 ? "relay" : "relays"} for your metadata
              events.
            </p>
          </div>

          {/* Progress bar while checking */}
          {!allRelaysChecked && allRelays.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs text-base-content/40">
                <span>
                  {doneCount} / {allRelays.length} checked
                </span>
                <span>{checkingCount} active</span>
              </div>
              <progress
                className="progress progress-primary w-full"
                value={doneCount}
                max={allRelays.length}
              />
            </div>
          )}

          {/* Relay list */}
          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
            {allRelays.map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                kindMap={relayKindMap.get(url)}
                checkState={relayStates.get(url) ?? "pending"}
              />
            ))}
          </div>

          {/* Summary when done */}
          {allRelaysChecked && bestEventsByKind.size > 0 && (
            <div className="bg-base-200/60 rounded-xl p-3 text-sm text-base-content/70">
              Found{" "}
              <span className="font-medium text-base-content">
                {bestEventsByKind.size} metadata{" "}
                {bestEventsByKind.size === 1 ? "event" : "events"}
              </span>{" "}
              across {allRelays.length}{" "}
              {allRelays.length === 1 ? "relay" : "relays"}. Broadcasting will
              push {bestEventsByKind.size === 1 ? "it" : "them"} to every relay.
            </div>
          )}

          {allRelaysChecked && bestEventsByKind.size === 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-sm text-warning">
              No metadata events were found on any of the checked relays.
            </div>
          )}

          {/* Error */}
          {broadcastError && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {broadcastError}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {allRelaysChecked ? (
              <button
                className="btn btn-primary w-full"
                onClick={handleBroadcast}
                disabled={broadcasting || bestEventsByKind.size === 0}
              >
                {broadcasting ? (
                  <>
                    <span className="loading loading-spinner loading-xs" />
                    Broadcasting…
                  </>
                ) : bestEventsByKind.size === 0 ? (
                  "Nothing to broadcast"
                ) : (
                  `Broadcast ${bestEventsByKind.size} ${bestEventsByKind.size === 1 ? "event" : "events"} to ${allRelays.length} relays`
                )}
              </button>
            ) : (
              <button className="btn btn-primary w-full" disabled>
                <span className="loading loading-spinner loading-xs" />
                Checking relays…
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm w-full"
              onClick={next}
              disabled={broadcasting}
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MetadataBroadcast;
