import type {
  BlockedRelays,
  FavoriteRelays,
  RelayDiscovery,
  RelayMonitor,
  SearchRelays,
} from "applesauce-common/casts";
import { defined } from "applesauce-core";
import type { EventTemplate } from "applesauce-core/helpers";
import {
  removeInboxRelay,
  removeOutboxRelay,
} from "applesauce-core/operations/mailboxes";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { use$ } from "applesauce-react/hooks";
import type { Relay } from "applesauce-relay";
import { useEffect, useMemo, useState } from "react";
import { combineLatest, of, timeout } from "rxjs";
import { map } from "rxjs/operators";
import { useReport } from "../../context/ReportContext.tsx";
import { factory } from "../../lib/factory.ts";
import { monitors$, relayStatusWithTimeout } from "../../lib/relay-monitors.ts";
import { pool } from "../../lib/relay.ts";
import { eventStore } from "../../lib/store.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ms to wait for each relay list observable before treating it as not found */
const LIST_LOAD_TIMEOUT_MS = 10_000;
/** ms to wait for all relay verdicts before treating unknowns as skippable */
const VERDICT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RelayVerdict = "online" | "offline" | "unknown";

/** Identifies which relay list kind a step targets */
type RelayListKind =
  | "nip65-outboxes"
  | "nip65-inboxes"
  | "favorite-relays"
  | "search-relays"
  | "dm-relays"
  | "blocked-relays";

/** A resolved relay list step: has at least one relay URL to check */
type RelayListStep = {
  kind: RelayListKind;
  label: string;
  /** The event kind number used to look up the event in eventStore */
  eventKind: number;
  urls: string[];
};

// ---------------------------------------------------------------------------
// Per-relay verdict hook (combines all monitors into a majority vote)
// ---------------------------------------------------------------------------

function useRelayVerdict(
  monitors: RelayMonitor[],
  relayUrl: string,
): RelayVerdict {
  const verdict = use$(() => {
    if (monitors.length === 0) return of("unknown" as RelayVerdict);
    const streams = monitors.map((m) => relayStatusWithTimeout(m, relayUrl));
    return combineLatest(streams).pipe(
      map((statuses) => {
        const loaded = statuses.filter((s) => s !== undefined);
        if (loaded.length === 0) return "unknown" as RelayVerdict;
        const online = loaded.filter(
          (s) => s !== null && s?.rttOpen !== undefined,
        ).length;
        const total = loaded.length;
        if (total === 0) return "unknown" as RelayVerdict;
        if (online > total / 2) return "online" as RelayVerdict;
        return "offline" as RelayVerdict;
      }),
    );
  }, [monitors.length, relayUrl]);
  return verdict ?? "unknown";
}

// ---------------------------------------------------------------------------
// Per-monitor status hook
// ---------------------------------------------------------------------------

function useMonitorRelayStatus(
  monitor: RelayMonitor,
  relayUrl: string,
): RelayDiscovery | null | undefined {
  return use$(
    () => relayStatusWithTimeout(monitor, relayUrl),
    [monitor.uid, relayUrl],
  );
}

// ---------------------------------------------------------------------------
// VerdictBadge
// ---------------------------------------------------------------------------

function VerdictBadge({ verdict }: { verdict: RelayVerdict }) {
  if (verdict === "online") {
    return <span className="badge badge-success badge-sm">online</span>;
  }
  if (verdict === "offline") {
    return <span className="badge badge-error badge-sm">offline</span>;
  }
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// MonitorDetailRow — per-monitor status under an offline relay
// ---------------------------------------------------------------------------

function MonitorDetailRow({
  monitor,
  relayUrl,
}: {
  monitor: RelayMonitor;
  relayUrl: string;
}) {
  const status = useMonitorRelayStatus(monitor, relayUrl);
  const profile = use$(monitor.author.profile$);
  const name = profile?.displayName ?? monitor.author.pubkey.slice(0, 8) + "…";

  let indicator: React.ReactNode;
  if (status === undefined) {
    indicator = (
      <span className="loading loading-spinner loading-xs opacity-40" />
    );
  } else if (status === null || status.rttOpen === undefined) {
    indicator = <span className="size-2 rounded-full bg-error inline-block" />;
  } else {
    indicator = (
      <span className="size-2 rounded-full bg-success inline-block" />
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-base-content/50">
      {indicator}
      <span>{name}</span>
      {status && status.rttOpen !== undefined && (
        <span className="ml-auto">{status.rttOpen} ms</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — single relay with verdict badge and remove button
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  relay,
  monitors,
  onRemove,
  removing,
}: {
  relayUrl: string;
  relay: Relay;
  monitors: RelayMonitor[];
  onRemove: (url: string) => void;
  removing: boolean;
}) {
  const verdict = useRelayVerdict(monitors, relayUrl);
  const isOffline = verdict === "offline";
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);

  const name = info?.name ?? relayUrl;
  const description = info?.description;

  return (
    <div
      className={[
        "rounded-xl border p-4 flex flex-col gap-3 transition-colors",
        isOffline ? "border-error/40 bg-error/5" : "border-base-200",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-3">
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
          <div className="min-w-0 flex flex-col gap-0.5">
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

      {isOffline && monitors.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t border-error/20">
          {monitors.map((m) => (
            <MonitorDetailRow key={m.uid} monitor={m} relayUrl={relayUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerdictTracker — RelayRow wrapper that reports verdict changes upward
// ---------------------------------------------------------------------------

function VerdictTracker({
  relayUrl,
  relay,
  monitors,
  removing,
  onRemove,
  onVerdict,
}: {
  relayUrl: string;
  relay: Relay;
  monitors: RelayMonitor[];
  removing: boolean;
  onRemove: (url: string) => void;
  onVerdict: (url: string, verdict: RelayVerdict) => void;
}) {
  const verdict = useRelayVerdict(monitors, relayUrl);

  useEffect(() => {
    onVerdict(relayUrl, verdict);
  }, [relayUrl, verdict, onVerdict]);

  return (
    <RelayRow
      relayUrl={relayUrl}
      relay={relay}
      monitors={monitors}
      onRemove={onRemove}
      removing={removing}
    />
  );
}

// ---------------------------------------------------------------------------
// StepView — renders the active relay list step
// ---------------------------------------------------------------------------

function StepView({
  step,
  stepIndex,
  totalSteps,
  monitors,
  onStepDone,
  subjectPubkey,
  publish,
}: {
  step: RelayListStep;
  stepIndex: number;
  totalSteps: number;
  monitors: RelayMonitor[];
  onStepDone: () => void;
  subjectPubkey: string;
  publish: (template: EventTemplate) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, RelayVerdict>>({});
  const [verdictTimedOut, setVerdictTimedOut] = useState(false);

  // Reset state when the step changes
  // (stepIndex changes = new step mounted, so state is already fresh because
  //  StepView gets remounted via key={stepIndex} at the call site)

  const relayList = useMemo(
    () => step.urls.filter((url) => !removed.has(url)),
    [step.urls, removed],
  );

  const relayEntries = useMemo(
    () => relayList.map((url) => ({ url, relay: pool.relay(url) })),
    [relayList],
  );

  // Verdict timeout — after VERDICT_TIMEOUT_MS unknowns become skippable
  useEffect(() => {
    if (relayList.length === 0) return;
    const timer = setTimeout(
      () => setVerdictTimedOut(true),
      VERDICT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [relayList.length]);

  const allHealthy = useMemo(() => {
    if (relayList.length === 0) return false;
    return relayList.every((url) => verdicts[url] === "online");
  }, [relayList, verdicts]);

  const hasOffline = useMemo(
    () => relayList.some((url) => verdicts[url] === "offline"),
    [relayList, verdicts],
  );

  const canProceed = useMemo(() => {
    if (hasOffline) return false;
    if (verdictTimedOut) return true;
    return relayList.every(
      (url) => verdicts[url] !== undefined && verdicts[url] !== "unknown",
    );
  }, [hasOffline, verdictTimedOut, relayList, verdicts]);

  // Auto-advance when everything confirmed healthy
  useEffect(() => {
    if (allHealthy) {
      const timer = setTimeout(() => onStepDone(), 1500);
      return () => clearTimeout(timer);
    }
  }, [allHealthy, onStepDone]);

  // All relays removed — auto-advance
  useEffect(() => {
    if (removed.size > 0 && relayList.length === 0) {
      const timer = setTimeout(() => onStepDone(), 1500);
      return () => clearTimeout(timer);
    }
  }, [removed.size, relayList.length, onStepDone]);

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

  const handleSetVerdict = useMemo(
    () => (url: string, verdict: RelayVerdict) =>
      setVerdicts((prev) =>
        prev[url] === verdict ? prev : { ...prev, [url]: verdict },
      ),
    [],
  );

  const allDone = removed.size > 0 && relayList.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-base-content/40">
          <span>{step.label}</span>
          <span>
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
        <progress
          className="progress progress-primary w-full"
          value={stepIndex}
          max={totalSteps}
        />
      </div>

      {/* Step header */}
      <div>
        <h1 className="text-2xl font-semibold text-base-content">
          {step.label}
        </h1>
        <p className="text-sm text-base-content/60 mt-1">
          Checking {relayList.length} relay{relayList.length !== 1 ? "s" : ""}{" "}
          against{" "}
          {monitors.length === 0
            ? "relay monitors"
            : `${monitors.length} relay monitor${monitors.length === 1 ? "" : "s"}`}
          .
        </p>
      </div>

      {/* All-removed success state */}
      {allDone && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="size-14 rounded-full bg-success/10 flex items-center justify-center">
            <svg
              className="size-7 text-success"
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
          <p className="text-sm text-base-content/60 text-center">
            All dead relays removed.
          </p>
          <span className="loading loading-dots loading-sm text-base-content/40" />
        </div>
      )}

      {/* All healthy success state */}
      {allHealthy && !allDone && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="size-14 rounded-full bg-success/10 flex items-center justify-center">
            <svg
              className="size-7 text-success"
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
            <p className="text-sm font-medium text-base-content">
              All relays online
            </p>
            <p className="text-xs text-base-content/60 mt-0.5">
              All {relayList.length} relay{relayList.length !== 1 ? "s" : ""}{" "}
              are reachable.
            </p>
          </div>
          <span className="loading loading-dots loading-sm text-base-content/40" />
        </div>
      )}

      {/* Relay list — shown while not in a terminal state */}
      {!allHealthy && !allDone && (
        <div className="flex flex-col gap-3">
          {relayEntries.map(({ url, relay }) => (
            <VerdictTracker
              key={url}
              relayUrl={url}
              relay={relay}
              monitors={monitors}
              removing={removing.has(url)}
              onRemove={handleRemove}
              onVerdict={handleSetVerdict}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
          {error}
        </div>
      )}

      {/* Offline callout */}
      {hasOffline && !allDone && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-sm text-warning">
          Some relays appear offline. Remove them to keep your relay list
          healthy.
        </div>
      )}

      {/* Next / Skip — always provide a way forward */}
      {!allHealthy && !allDone && (
        <div className="flex flex-col gap-2">
          <button
            className="btn btn-primary w-full"
            onClick={onStepDone}
            disabled={!canProceed}
          >
            {canProceed ? "Next" : "Checking…"}
          </button>
          {!canProceed && (
            <button
              className="btn btn-ghost btn-sm w-full"
              onClick={onStepDone}
            >
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — DeadRelays
// ---------------------------------------------------------------------------

function DeadRelays() {
  const { subject: subjectUser, next, publish: publishEvent } = useReport();

  // Load monitors
  const monitors = use$(monitors$) ?? [];

  // -------------------------------------------------------------------------
  // Load all relay lists upfront; each resolves to null on timeout/missing
  // -------------------------------------------------------------------------

  const outboxes = use$(
    () =>
      subjectUser
        ? subjectUser.outboxes$.pipe(
            defined(),
            timeout({ first: LIST_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  const inboxes = use$(
    () =>
      subjectUser
        ? subjectUser.inboxes$.pipe(
            defined(),
            timeout({ first: LIST_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  const favoriteRelays = use$(
    () =>
      subjectUser
        ? subjectUser.favoriteRelays$.pipe(
            defined(),
            timeout({ first: LIST_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  ) as FavoriteRelays | null | undefined;

  const searchRelays = use$(
    () =>
      subjectUser
        ? subjectUser.searchRelays$.pipe(
            defined(),
            timeout({ first: LIST_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  ) as SearchRelays | null | undefined;

  const dmRelays = use$(
    () =>
      subjectUser
        ? subjectUser.directMessageRelays$.pipe(
            defined(),
            timeout({ first: LIST_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  const blockedRelays = use$(
    () =>
      subjectUser
        ? subjectUser.blockedRelays$.pipe(
            defined(),
            timeout({ first: LIST_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  ) as BlockedRelays | null | undefined;

  // All 6 lists are loaded when none are still undefined
  const allLoaded =
    outboxes !== undefined &&
    inboxes !== undefined &&
    favoriteRelays !== undefined &&
    searchRelays !== undefined &&
    dmRelays !== undefined &&
    blockedRelays !== undefined;

  // -------------------------------------------------------------------------
  // Build the active steps list — only lists that have ≥1 relay URL
  // Computed once when all lists resolve; stable after that.
  // -------------------------------------------------------------------------

  const activeSteps = useMemo<RelayListStep[]>(() => {
    if (!allLoaded) return [];
    const steps: RelayListStep[] = [];

    const push = (
      kind: RelayListKind,
      label: string,
      eventKind: number,
      urls: string[] | null | undefined,
    ) => {
      if (urls && urls.length > 0) {
        steps.push({ kind, label, eventKind, urls });
      }
    };

    push("nip65-outboxes", "Outbox Relays", 10002, outboxes);
    push("nip65-inboxes", "Inbox Relays", 10002, inboxes);
    push(
      "favorite-relays",
      "Favorite Relays",
      10012,
      favoriteRelays?.relays ?? null,
    );
    push("search-relays", "Search Relays", 10007, searchRelays?.relays ?? null);
    push("dm-relays", "DM Relays", 10050, dmRelays);
    push(
      "blocked-relays",
      "Blocked Relays",
      10006,
      blockedRelays?.relays ?? null,
    );

    return steps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLoaded]);

  // -------------------------------------------------------------------------
  // Step state
  // -------------------------------------------------------------------------

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  function advanceStep() {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= activeSteps.length) {
      next();
    } else {
      setCurrentStepIndex(nextIndex);
    }
  }

  // -------------------------------------------------------------------------
  // Loading state — waiting for relay lists to resolve
  // -------------------------------------------------------------------------

  if (!allLoaded) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your relay lists…
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
  // No relay lists found — all lists were null/empty
  // -------------------------------------------------------------------------

  if (activeSteps.length === 0) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-semibold text-base-content">
                Dead Relay Check
              </h1>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
              No relay lists could be found for this account. They may not exist
              yet, or relays were unreachable.
            </div>
            <button className="btn btn-primary w-full" onClick={next}>
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main sequential step view
  // -------------------------------------------------------------------------

  const currentStep = activeSteps[currentStepIndex];

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm">
          {subjectUser && (
            <StepView
              key={currentStepIndex}
              step={currentStep}
              stepIndex={currentStepIndex}
              totalSteps={activeSteps.length}
              monitors={monitors}
              onStepDone={advanceStep}
              subjectPubkey={subjectUser.pubkey}
              publish={publishEvent}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default DeadRelays;
