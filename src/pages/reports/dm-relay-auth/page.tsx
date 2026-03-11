import { useEffect, useMemo, useState } from "react";
import type { EventTemplate } from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { use$ } from "applesauce-react/hooks";
import { timer } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { toLoaderState } from "../../../observable/operator/to-loader-state.ts";
import { useReport } from "../../../context/ReportContext.tsx";
import { factory } from "../../../lib/factory.ts";
import { pool } from "../../../lib/relay.ts";
import { eventStore } from "../../../lib/store.ts";
import {
  AUTO_ADVANCE_MS,
  EVENT_LOAD_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";
import { createLoader } from "./loader.ts";
import type { AuthStatus } from "./loader.ts";

// ---------------------------------------------------------------------------
// AuthBadge — derives status display from loader state
// ---------------------------------------------------------------------------

function AuthBadge({ status }: { status: AuthStatus | null | undefined }) {
  if (status === "protected")
    return (
      <span className="badge badge-success badge-sm whitespace-nowrap">
        Auth Required
      </span>
    );
  if (status === "unprotected")
    return (
      <span className="badge badge-error badge-sm whitespace-nowrap">
        No Auth
      </span>
    );
  if (status === "unknown")
    return (
      <span className="badge badge-ghost badge-sm whitespace-nowrap">
        Unknown
      </span>
    );
  // null or undefined = still probing
  return (
    <span className="badge badge-ghost badge-sm gap-1 whitespace-nowrap">
      <span className="loading loading-spinner loading-xs" />
      Checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — reads auth status from loader state, not from a hook
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  authStatus,
  selected,
  onToggle,
}: {
  relayUrl: string;
  authStatus: AuthStatus | null | undefined;
  selected: boolean;
  onToggle: (url: string) => void;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isUnprotected = authStatus === "unprotected";
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
        <span className="font-mono text-xs text-base-content/60 break-all">
          {relayUrl}
        </span>
        {description != null && description !== "" && (
          <p className="text-xs text-base-content/70 line-clamp-2 mt-0.5">
            {description}
          </p>
        )}
      </div>
      <AuthBadge status={authStatus} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function DmRelayAuth() {
  const { subject, next, publish: publishEvent } = useReport();

  // -------------------------------------------------------------------------
  // Loader — streams DmRelayAuthState including per-relay auth probes
  // -------------------------------------------------------------------------
  const loaderState = use$(
    () =>
      subject
        ? createLoader(subject).pipe(
            takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
            toLoaderState(),
          )
        : undefined,
    [subject?.pubkey],
  );

  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const relayUrls = state?.relayUrls ?? null;
  const authStatus = useMemo(
    () => state?.authStatus ?? {},
    [state?.authStatus],
  );
  const relayList = useMemo<string[]>(() => relayUrls ?? [], [relayUrls]);

  // -------------------------------------------------------------------------
  // Derive verdicts from loader state (no React hooks needed)
  // -------------------------------------------------------------------------
  const unprotectedUrls = useMemo(
    () => relayList.filter((url) => authStatus[url] === "unprotected"),
    [relayList, authStatus],
  );

  const allProtected = useMemo(
    () =>
      !isLoading &&
      relayUrls !== null &&
      relayList.length > 0 &&
      unprotectedUrls.length === 0 &&
      relayList.every(
        (url) => authStatus[url] !== null && authStatus[url] !== undefined,
      ),
    [isLoading, relayUrls, relayList, unprotectedUrls.length, authStatus],
  );

  // -------------------------------------------------------------------------
  // Page-local UI state — selection, publish
  // -------------------------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select unprotected relays when discovered
  useEffect(() => {
    if (unprotectedUrls.length > 0) setSelected(new Set(unprotectedUrls));
  }, [unprotectedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance when all relays are protected
  useEffect(() => {
    if (allProtected) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [allProtected, next]);

  // Auto-advance after successful publish
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [done, next]);

  function handleToggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleRemoveSelected() {
    if (!subject || selected.size === 0) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(10050, subject.pubkey);
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
  // Loading — show partial relay rows with "checking" badges as probes stream in
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <span className="loading loading-spinner loading-lg text-primary shrink-0" />
              <p className="text-sm text-base-content/60">
                {relayList.length > 0
                  ? `Probing ${relayList.length} DM relay${relayList.length === 1 ? "" : "s"}…`
                  : "Loading your DM relay list…"}
              </p>
            </div>
            {relayList.length > 0 && (
              <div className="flex flex-col gap-3">
                {relayList.map((url) => (
                  <RelayRow
                    key={url}
                    relayUrl={url}
                    authStatus={authStatus[url]}
                    selected={selected.has(url)}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not found
  if (relayUrls === null) {
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

  // Empty list
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

  // All protected (auto-advancing)
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

  // Done (auto-advancing)
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

  // Main view
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
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

          <div className="flex flex-col gap-3">
            {relayList.map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                authStatus={authStatus[url]}
                selected={selected.has(url)}
                onToggle={handleToggle}
              />
            ))}
          </div>

          {unprotectedUrls.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-sm text-warning">
                {unprotectedUrls.length}{" "}
                {unprotectedUrls.length === 1 ? "relay does" : "relays do"} not
                require authentication to read gift wraps. Anyone can query
                these relays for your encrypted messages.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setSelected(new Set(unprotectedUrls))}
                  disabled={selected.size === unprotectedUrls.length}
                >
                  Select all
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                >
                  Deselect all
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

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
              disabled={publishing}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DmRelayAuth;
