import { useEffect, useMemo, useState } from "react";
import type { NostrEvent } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { timer } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { toLoaderState } from "../../../observable/operator/to-loader-state.ts";
import { useReport } from "../../../context/ReportContext.tsx";
import { pool } from "../../../lib/relay.ts";
import {
  AUTO_ADVANCE_MS,
  BROADCAST_TIMEOUT_MS,
  EVENT_LOAD_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";
import { createLoader, METADATA_KINDS } from "./loader.ts";
import type { MetadataBroadcastState } from "./loader.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KindEntry = {
  kind: number;
  label: string;
  description: string;
};

const METADATA_KIND_ENTRIES: KindEntry[] = [
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

type RelayCheckState = "pending" | "checking" | "done";

// ---------------------------------------------------------------------------
// KindBadge
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
// RelayRow — shows per-relay coverage status
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
      <div className="flex flex-wrap gap-1.5">
        {METADATA_KIND_ENTRIES.map((ke) => (
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
// Derive relay check state from loader state
// A relay is "checking" once it appears in relayKindMap (even with empty Map),
// "done" once its stream has completed (indicated by its kind count stabilising
// — we approximate this by treating each relay as "checking" until RELAY_REQUEST_TIMEOUT_MS
// fires via the page-level takeUntil that completes the loader).
// Since we can't know per-relay completion from the merged state, we treat
// all relays as "checking" while !loaderComplete and "done" after.
// ---------------------------------------------------------------------------

function deriveCheckState(
  url: string,
  relayKindMap: Map<string, Map<number, NostrEvent>>,
  loaderComplete: boolean,
): RelayCheckState {
  if (!relayKindMap.has(url)) return "pending";
  if (loaderComplete) return "done";
  return "checking";
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function MetadataBroadcast() {
  const { subject, next } = useReport();

  // -------------------------------------------------------------------------
  // Loader — streams MetadataBroadcastState as each relay responds
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
  const state: MetadataBroadcastState | undefined = loaderState?.data;

  const allRelays = useMemo(() => state?.allRelays ?? [], [state?.allRelays]);
  const relayKindMap = useMemo(
    () => state?.relayKindMap ?? new Map<string, Map<number, NostrEvent>>(),
    [state?.relayKindMap],
  );

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------
  const allRelaysChecked = !isLoading && allRelays.length > 0;

  // Best event per kind across all relays (highest created_at)
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

  const allKindsPresentEverywhere = useMemo(() => {
    if (!allRelaysChecked || allRelays.length === 0) return false;
    return allRelays.every((url) => {
      const kindMap = relayKindMap.get(url);
      return METADATA_KINDS.every((k) => kindMap?.has(k));
    });
  }, [allRelaysChecked, allRelays, relayKindMap]);

  // -------------------------------------------------------------------------
  // Broadcast
  // -------------------------------------------------------------------------
  const [broadcasting, setBroadcasting] = useState(false);
  const [done, setDone] = useState(false);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [publishProgress, setPublishProgress] = useState(0);

  function handleBroadcast() {
    if (bestEventsByKind.size === 0) {
      next();
      return;
    }
    setBroadcasting(true);
    setBroadcastError(null);
    setPublishProgress(0);
    const events = Array.from(bestEventsByKind.values());
    const total = events.length;
    let settled = 0;
    function onSettled() {
      settled += 1;
      setPublishProgress(settled);
      if (settled >= total) {
        setDone(true);
        setBroadcasting(false);
      }
    }
    for (const event of events) {
      pool.publish(allRelays, event).then(onSettled).catch(onSettled);
    }
  }

  useEffect(() => {
    if (!broadcasting) return;
    const t = setTimeout(() => {
      setBroadcasting(false);
      next();
    }, BROADCAST_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [broadcasting, next]);

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [done, next]);

  useEffect(() => {
    if (allKindsPresentEverywhere) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [allKindsPresentEverywhere, next]);

  // -------------------------------------------------------------------------
  // Loading — show partial relay rows as they stream in
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <span className="loading loading-spinner loading-lg text-primary shrink-0" />
              <div>
                <h1 className="text-lg font-semibold text-base-content">
                  Metadata Broadcast
                </h1>
                <p className="text-sm text-base-content/60">
                  {allRelays.length > 0
                    ? `Checking ${allRelays.length} relays…`
                    : "Loading relay list…"}
                </p>
              </div>
            </div>

            {/* Show relay rows as they stream in during loading */}
            {allRelays.length > 0 && (
              <div className="flex flex-col gap-3 max-h-80 overflow-y-auto">
                {allRelays.map((url) => (
                  <RelayRow
                    key={url}
                    relayUrl={url}
                    kindMap={relayKindMap.get(url)}
                    checkState={deriveCheckState(url, relayKindMap, false)}
                  />
                ))}
              </div>
            )}

            <button className="btn btn-ghost btn-sm w-full" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // All-clear (auto-advancing)
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

  // Broadcasting
  if (broadcasting && bestEventsByKind.size > 0) {
    const total = bestEventsByKind.size;
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <div className="text-center w-full">
              <h2 className="text-lg font-semibold text-base-content">
                Broadcasting metadata…
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                {publishProgress} of {total} {total === 1 ? "event" : "events"}{" "}
                published
              </p>
            </div>
            <progress
              className="progress progress-primary w-full"
              value={publishProgress}
              max={total}
            />
            <p className="text-xs text-base-content/40">
              This may take a moment. You can skip to continue.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Done
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

  // Main view
  const doneCount = allRelays.filter(
    (url) => deriveCheckState(url, relayKindMap, true) === "done",
  ).length;

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
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

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-base-content/40">
              <span>
                {doneCount} / {allRelays.length} checked
              </span>
            </div>
            <progress
              className="progress progress-primary w-full"
              value={doneCount}
              max={allRelays.length}
            />
          </div>

          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
            {allRelays.map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                kindMap={relayKindMap.get(url)}
                checkState={deriveCheckState(url, relayKindMap, true)}
              />
            ))}
          </div>

          {bestEventsByKind.size > 0 && (
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

          {bestEventsByKind.size === 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-sm text-warning">
              No metadata events were found on any of the checked relays.
            </div>
          )}

          {broadcastError && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {broadcastError}
            </div>
          )}

          <div className="flex flex-col gap-2">
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
