import type { EventTemplate } from "applesauce-core/helpers";
import {
  removeInboxRelay,
  removeOutboxRelay,
} from "applesauce-core/operations/mailboxes";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { use$ } from "applesauce-react/hooks";
import { useEffect, useMemo, useState } from "react";
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
import deadRelaysLoader from "./loader.ts";
import type { DeadRelaysState } from "./loader.ts";
import type { RelayVerdict } from "../../../lib/relay-monitors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifies which relay list kind a step targets */
type RelayListKind =
  | "nip65-outboxes"
  | "nip65-inboxes"
  | "favorite-relays"
  | "search-relays"
  | "dm-relays"
  | "blocked-relays";

/** A resolved relay list step with at least one relay URL */
type RelayListStep = {
  kind: RelayListKind;
  label: string;
  /** The event kind number for eventStore lookup in the remove handler */
  eventKind: number;
  urls: string[];
  /** Per-relay verdicts from the sub-loader for this list */
  verdicts: Record<string, RelayVerdict | null>;
};

// ---------------------------------------------------------------------------
// VerdictBadge — reads verdict directly from loader state
// ---------------------------------------------------------------------------

function VerdictBadge({
  verdict,
}: {
  verdict: RelayVerdict | null | undefined;
}) {
  if (verdict === "online")
    return <span className="badge badge-success badge-sm">online</span>;
  if (verdict === "offline")
    return <span className="badge badge-error badge-sm">offline</span>;
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — reads verdict from loader state (no hook)
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  verdict,
  onRemove,
  removing,
}: {
  relayUrl: string;
  verdict: RelayVerdict | null | undefined;
  onRemove: (url: string) => void;
  removing: boolean;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isOffline = verdict === "offline";
  const name = info?.name ?? relayUrl;

  return (
    <div
      className={[
        "flex items-center gap-2 py-2 min-w-0",
        isOffline ? "border-l-2 border-error pl-2 -ml-0.5" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="size-6 rounded shrink-0 object-cover bg-base-200"
          />
        ) : (
          <div
            className="size-6 rounded shrink-0 bg-base-200 flex items-center justify-center text-base-content/40 text-[10px] font-mono"
            aria-hidden
          >
            …
          </div>
        )}
        <div className="min-w-0 flex flex-col gap-0">
          <span className="font-medium text-sm text-base-content truncate leading-tight">
            {name}
          </span>
          <span className="font-mono text-[11px] text-base-content/50 truncate">
            {relayUrl}
          </span>
        </div>
      </div>
      <VerdictBadge verdict={verdict} />
      {isOffline && (
        <button
          className="btn btn-error btn-xs shrink-0"
          onClick={() => onRemove(relayUrl)}
          disabled={removing}
        >
          {removing ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            "Remove"
          )}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListSection — one relay list with progress bar and relay rows
// ---------------------------------------------------------------------------

function ListSection({
  step,
  subjectPubkey,
  publish,
}: {
  step: RelayListStep;
  subjectPubkey: string;
  publish: (template: EventTemplate) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const relayList = useMemo(
    () => step.urls.filter((url) => !removed.has(url)),
    [step.urls, removed],
  );

  const loadedCount = useMemo(
    () => relayList.filter((url) => step.verdicts[url] !== null).length,
    [relayList, step.verdicts],
  );

  const hasOffline = useMemo(
    () => relayList.some((url) => step.verdicts[url] === "offline"),
    [relayList, step.verdicts],
  );

  const allHealthy = useMemo(
    () =>
      relayList.length > 0 &&
      relayList.every((url) => step.verdicts[url] === "online"),
    [relayList, step.verdicts],
  );

  const allDone = removed.size > 0 && relayList.length === 0;

  async function handleRemove(relayUrl: string) {
    setRemoving((prev) => new Set(prev).add(relayUrl));
    setError(null);
    try {
      const existing = eventStore.getReplaceable(step.eventKind, subjectPubkey);
      if (!existing)
        throw new Error(
          `Could not find the relay list event (kind:${step.eventKind}).`,
        );

      let draft: EventTemplate;
      if (step.kind === "nip65-outboxes") {
        draft = await factory.modify(existing, removeOutboxRelay(relayUrl));
      } else if (step.kind === "nip65-inboxes") {
        draft = await factory.modify(existing, removeInboxRelay(relayUrl));
      } else {
        draft = await factory.modify(
          existing,
          modifyPublicTags(removeRelayTag(relayUrl)),
        );
      }

      await publish(draft);
      setRemoved((prev) => new Set(prev).add(relayUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove relay.");
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(relayUrl);
        return next;
      });
    }
  }

  const total = relayList.length;
  const progressMax = total > 0 ? total : 1;
  const progressValue = total > 0 ? loadedCount : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center gap-2">
        <span className="text-sm font-medium text-base-content">
          {step.label}
        </span>
        <span className="text-xs text-base-content/50 tabular-nums shrink-0">
          {total === 0 ? "0 relays" : `${loadedCount} / ${total}`}
        </span>
      </div>
      <progress
        className="progress progress-primary w-full h-1.5"
        value={progressValue}
        max={progressMax}
      />

      {total === 0 && (
        <p className="text-xs text-base-content/50">No relays in this list.</p>
      )}

      {allDone && (
        <p className="text-xs text-success">
          All dead relays removed from this list.
        </p>
      )}

      {allHealthy && !allDone && (
        <p className="text-xs text-success">
          All {relayList.length} relay{relayList.length !== 1 ? "s" : ""}{" "}
          online.
        </p>
      )}

      {!allHealthy && !allDone && total > 0 && (
        <div className="flex flex-col gap-0">
          {relayList.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              verdict={step.verdicts[url]}
              onRemove={handleRemove}
              removing={removing.has(url)}
            />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {hasOffline && !allDone && (
        <p className="text-xs text-warning">
          Some relays offline — remove to keep list healthy.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build all relay list sections from loader state (always 6 sections)
// ---------------------------------------------------------------------------

const LIST_SECTIONS: Array<{
  kind: RelayListKind;
  label: string;
  eventKind: number;
  key: keyof DeadRelaysState;
}> = [
  {
    kind: "nip65-outboxes",
    label: "Outbox Relays",
    eventKind: 10002,
    key: "outboxes",
  },
  {
    kind: "nip65-inboxes",
    label: "Inbox Relays",
    eventKind: 10002,
    key: "inboxes",
  },
  {
    kind: "favorite-relays",
    label: "Favorite Relays",
    eventKind: 10012,
    key: "favoriteRelays",
  },
  {
    kind: "search-relays",
    label: "Search Relays",
    eventKind: 10007,
    key: "searchRelays",
  },
  { kind: "dm-relays", label: "DM Relays", eventKind: 10050, key: "dmRelays" },
  {
    kind: "blocked-relays",
    label: "Blocked Relays",
    eventKind: 10006,
    key: "blockedRelays",
  },
];

function buildActiveSteps(
  state: DeadRelaysState | null | undefined,
): RelayListStep[] {
  if (!state)
    return LIST_SECTIONS.map(({ kind, label, eventKind }) => ({
      kind,
      label,
      eventKind,
      urls: [],
      verdicts: {},
    }));

  return LIST_SECTIONS.map(({ kind, label, eventKind, key }) => {
    const listState = state[key];
    const urls = listState?.urls ?? [];
    const verdicts = listState?.verdicts ?? {};
    return { kind, label, eventKind, urls, verdicts };
  });
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function DeadRelays() {
  const { subject, next, publish: publishEvent } = useReport();

  // -------------------------------------------------------------------------
  // Loader — Phase 1 streams relay lists, Phase 2 streams verdicts
  // -------------------------------------------------------------------------
  const loaderState = use$(
    () =>
      subject
        ? deadRelaysLoader(subject).pipe(
            takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
            toLoaderState(),
          )
        : undefined,
    [subject?.pubkey],
  );

  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const activeSteps = useMemo<RelayListStep[]>(
    () => buildActiveSteps(state),
    [state],
  );

  const hasAnyRelays = useMemo(
    () => activeSteps.some((s) => s.urls.length > 0),
    [activeSteps],
  );

  /** True when load is complete, every list is fully checked, and no relay is offline */
  const allCheckedAndHealthy = useMemo(() => {
    return activeSteps.every((step) => {
      if (step.urls.length === 0) return true;
      return step.urls.every((url) => {
        const v = step.verdicts[url];
        return v !== null && v !== "offline";
      });
    });
  }, [activeSteps]);

  useEffect(() => {
    if (!allCheckedAndHealthy || !hasAnyRelays) return;
    const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [allCheckedAndHealthy, hasAnyRelays, next]);

  // -------------------------------------------------------------------------
  // Loading — show all list sections with progress bars as data streams in
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner loading-md text-primary" />
            <p className="text-sm text-base-content/60">Loading relay lists…</p>
          </div>
          <div className="flex flex-col gap-3">
            {activeSteps.map((step) => (
              <div key={step.kind} className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-base-content/80">
                    {step.label}
                  </span>
                  <span className="text-xs text-base-content/50 tabular-nums">
                    {step.urls.length === 0
                      ? "…"
                      : `${step.urls.filter((u) => step.verdicts[u] !== null).length} / ${step.urls.length}`}
                  </span>
                </div>
                <progress
                  className="progress progress-primary w-full h-1.5"
                  value={
                    step.urls.length === 0
                      ? 0
                      : step.urls.filter((u) => step.verdicts[u] !== null)
                          .length
                  }
                  max={step.urls.length || 1}
                />
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm w-full" onClick={next}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  // Load complete but no relays in any list
  if (!hasAnyRelays) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-base-content">
            Dead Relay Check
          </h1>
          <p className="text-sm text-warning">
            No relay lists could be found for this account.
          </p>
          <button className="btn btn-primary w-full btn-sm" onClick={next}>
            Continue anyway
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-base-content">
            Dead Relay Check
          </h1>
          <p className="text-xs text-base-content/60 mt-0.5">
            Status per list. Remove offline relays to keep lists healthy.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {activeSteps.map((step) => (
            <ListSection
              key={step.kind}
              step={step}
              subjectPubkey={subject!.pubkey}
              publish={publishEvent}
            />
          ))}
        </div>
        <button className="btn btn-primary w-full btn-sm" onClick={next}>
          Next
        </button>
      </div>
    </div>
  );
}

export default DeadRelays;
