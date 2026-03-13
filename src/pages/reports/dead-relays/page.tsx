import type { EventTemplate } from "applesauce-core/helpers";
import {
  removeInboxRelay,
  removeOutboxRelay,
} from "applesauce-core/operations/mailboxes";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { use$ } from "applesauce-react/hooks";
import { useEffect, useMemo, useState } from "react";
import { factory } from "../../../lib/factory.ts";
import { pool } from "../../../lib/relay.ts";
import { eventStore } from "../../../lib/store.ts";
import type { SectionProps } from "../accordion-types.ts";
import type {
  DeadRelaysState,
  Nip65RelayListState,
  RelayListState,
  RelayMarker,
} from "./loader.ts";
import type { RelayVerdict } from "../../../lib/relay-monitors";

// ---------------------------------------------------------------------------
// Shared types used in the page layer
// ---------------------------------------------------------------------------

type Nip65ListStep = {
  kind: "nip65";
  label: string;
  eventKind: 10002;
  urls: string[];
  markers: Record<string, RelayMarker>;
  verdicts: Record<string, RelayVerdict | null>;
};

type SimpleListStep = {
  kind: "favorite-relays" | "search-relays" | "dm-relays" | "blocked-relays";
  label: string;
  eventKind: number;
  urls: string[];
  verdicts: Record<string, RelayVerdict | null>;
};

// ---------------------------------------------------------------------------
// MarkerPill — read / write / both badge for NIP-65 relays
// ---------------------------------------------------------------------------

function MarkerPill({ marker }: { marker: RelayMarker }) {
  if (marker === "both") {
    return (
      <span className="badge badge-ghost badge-xs font-mono">read+write</span>
    );
  }
  if (marker === "read") {
    return <span className="badge badge-ghost badge-xs font-mono">read</span>;
  }
  return <span className="badge badge-ghost badge-xs font-mono">write</span>;
}

// ---------------------------------------------------------------------------
// VerdictBadge
// ---------------------------------------------------------------------------

function VerdictBadge({
  verdict,
  isChecking,
}: {
  verdict: RelayVerdict | null | undefined;
  isChecking: boolean;
}) {
  if (verdict === "offline")
    return <span className="badge badge-error badge-sm">offline</span>;
  if (verdict === "online")
    return <span className="badge badge-success badge-sm">online</span>;
  if (!isChecking)
    return <span className="badge badge-ghost badge-sm">unknown</span>;
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — shared for all list types, optional marker pill
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  verdict,
  isChecking,
  marker,
  onRemove,
  removing,
}: {
  relayUrl: string;
  verdict: RelayVerdict | null | undefined;
  isChecking: boolean;
  marker?: RelayMarker;
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
      {marker && <MarkerPill marker={marker} />}
      <VerdictBadge verdict={verdict} isChecking={isChecking} />
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
// Nip65Section — the combined read/write relay list
// ---------------------------------------------------------------------------

function Nip65Section({
  step,
  subjectPubkey,
  publish,
  isChecking,
}: {
  step: Nip65ListStep;
  subjectPubkey: string;
  publish: (template: EventTemplate) => Promise<void>;
  isChecking: boolean;
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
  const allDone = removed.size > 0 && relayList.length === 0;

  async function handleRemove(relayUrl: string) {
    setRemoving((prev) => new Set(prev).add(relayUrl));
    setError(null);
    try {
      const existing = eventStore.getReplaceable(10002, subjectPubkey);
      if (!existing)
        throw new Error("Could not find your relay list (kind:10002).");
      const marker = step.markers[relayUrl];
      let draft: EventTemplate;
      // Remove from both read and write sides to fully excise the relay
      if (marker === "both") {
        const afterWrite = await factory.modify(
          existing,
          removeOutboxRelay(relayUrl),
        );
        draft = await factory.modify(afterWrite, removeInboxRelay(relayUrl));
      } else if (marker === "write") {
        draft = await factory.modify(existing, removeOutboxRelay(relayUrl));
      } else {
        draft = await factory.modify(existing, removeInboxRelay(relayUrl));
      }
      await publish(draft);
      setRemoved((prev) => new Set(prev).add(relayUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove relay.");
    } finally {
      setRemoving((prev) => {
        const n = new Set(prev);
        n.delete(relayUrl);
        return n;
      });
    }
  }

  const total = relayList.length;
  if (total === 0 && removed.size === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center gap-2">
        <span className="text-sm font-medium text-base-content">
          {step.label}
        </span>
        <span className="text-xs text-base-content/50 tabular-nums shrink-0">
          {total === 0 ? "cleaned" : `${loadedCount} / ${total}`}
        </span>
      </div>
      {total > 0 && (
        <progress
          className="progress progress-primary w-full h-1"
          value={loadedCount}
          max={total}
        />
      )}
      {allDone && (
        <p className="text-xs text-success">All dead relays removed.</p>
      )}
      {!allDone && total > 0 && (
        <div className="flex flex-col gap-0">
          {relayList.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              verdict={step.verdicts[url]}
              isChecking={isChecking}
              marker={step.markers[url]}
              onRemove={handleRemove}
              removing={removing.has(url)}
            />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SimpleListSection — for favorite/search/DM/blocked relay lists
// ---------------------------------------------------------------------------

function SimpleListSection({
  step,
  subjectPubkey,
  publish,
  isChecking,
}: {
  step: SimpleListStep;
  subjectPubkey: string;
  publish: (template: EventTemplate) => Promise<void>;
  isChecking: boolean;
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
      const draft = await factory.modify(
        existing,
        modifyPublicTags(removeRelayTag(relayUrl)),
      );
      await publish(draft);
      setRemoved((prev) => new Set(prev).add(relayUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove relay.");
    } finally {
      setRemoving((prev) => {
        const n = new Set(prev);
        n.delete(relayUrl);
        return n;
      });
    }
  }

  const total = relayList.length;
  if (total === 0 && removed.size === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center gap-2">
        <span className="text-sm font-medium text-base-content">
          {step.label}
        </span>
        <span className="text-xs text-base-content/50 tabular-nums shrink-0">
          {total === 0 ? "cleaned" : `${loadedCount} / ${total}`}
        </span>
      </div>
      {total > 0 && (
        <progress
          className="progress progress-primary w-full h-1"
          value={loadedCount}
          max={total}
        />
      )}
      {allDone && (
        <p className="text-xs text-success">All dead relays removed.</p>
      )}
      {!allDone && total > 0 && (
        <div className="flex flex-col gap-0">
          {relayList.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              verdict={step.verdicts[url]}
              isChecking={isChecking}
              onRemove={handleRemove}
              removing={removing.has(url)}
            />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build steps from loader state
// ---------------------------------------------------------------------------

const SIMPLE_SECTIONS: Array<{
  kind: SimpleListStep["kind"];
  label: string;
  eventKind: number;
  key: keyof Omit<DeadRelaysState, "nip65">;
}> = [
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
  {
    kind: "dm-relays",
    label: "DM Relays (inbox)",
    eventKind: 10050,
    key: "dmRelays",
  },
  {
    kind: "blocked-relays",
    label: "Blocked Relays",
    eventKind: 10006,
    key: "blockedRelays",
  },
];

function buildNip65Step(
  nip65: Nip65RelayListState | null | undefined,
): Nip65ListStep {
  return {
    kind: "nip65",
    label: "Relay List (NIP-65)",
    eventKind: 10002,
    urls: nip65?.urls ?? [],
    markers: nip65?.markers ?? {},
    verdicts: nip65?.verdicts ?? {},
  };
}

function buildSimpleSteps(
  state: DeadRelaysState | null | undefined,
): SimpleListStep[] {
  return SIMPLE_SECTIONS.map(({ kind, label, eventKind, key }) => {
    const listState = state?.[key] as RelayListState | undefined;
    return {
      kind,
      label,
      eventKind,
      urls: listState?.urls ?? [],
      verdicts: listState?.verdicts ?? {},
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers for all-checked-and-healthy derivation
// ---------------------------------------------------------------------------

function isListFullyHealthy(
  urls: string[],
  verdicts: Record<string, RelayVerdict | null>,
): boolean {
  if (urls.length === 0) return true;
  return urls.every(
    (url) => verdicts[url] !== null && verdicts[url] !== "offline",
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyBanner
// ---------------------------------------------------------------------------

function ReadOnlyBanner() {
  return (
    <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
      You're viewing someone else's account. Removals will be queued as drafts
      and need signing at the end.
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportContent
// ---------------------------------------------------------------------------

export function ReportContent({
  subject,
  account,
  publish: publishEvent,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<DeadRelaysState>) {
  const isReadOnly = account === null;
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const nip65Step = useMemo(() => buildNip65Step(state?.nip65), [state?.nip65]);
  const simpleSteps = useMemo(() => buildSimpleSteps(state), [state]);

  const hasAnyRelays = useMemo(
    () =>
      nip65Step.urls.length > 0 || simpleSteps.some((s) => s.urls.length > 0),
    [nip65Step, simpleSteps],
  );

  const allCheckedAndHealthy = useMemo(() => {
    if (!hasAnyRelays) return false;
    if (!isListFullyHealthy(nip65Step.urls, nip65Step.verdicts)) return false;
    return simpleSteps.every((s) => isListFullyHealthy(s.urls, s.verdicts));
  }, [hasAnyRelays, nip65Step, simpleSteps]);

  const [reported, setReported] = useState(false);

  // Record the outcome as soon as loading finishes — but don't auto-advance
  useEffect(() => {
    if (!isLoading && hasAnyRelays && !reported) {
      setReported(true);
      const totalRelays =
        nip65Step.urls.length +
        simpleSteps.reduce((sum, s) => sum + s.urls.length, 0);
      const offlineCount =
        nip65Step.urls.filter((u) => nip65Step.verdicts[u] === "offline")
          .length +
        simpleSteps.reduce(
          (sum, s) =>
            sum + s.urls.filter((u) => s.verdicts[u] === "offline").length,
          0,
        );
      onDone({
        status: offlineCount > 0 ? "error" : "clean",
        summary:
          offlineCount > 0
            ? `${offlineCount} offline relay${offlineCount !== 1 ? "s" : ""} found`
            : `All ${totalRelays} relay${totalRelays !== 1 ? "s" : ""} online`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasAnyRelays]);

  // ---------------------------------------------------------------------------
  // Loading state — show relay rows as soon as URLs arrive
  // ---------------------------------------------------------------------------
  if (isLoading) {
    const hasPartialData =
      nip65Step.urls.length > 0 || simpleSteps.some((s) => s.urls.length > 0);
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            {hasPartialData ? "Checking relays…" : "Loading relay lists…"}
          </p>
        </div>
        {hasPartialData && (
          <div className="flex flex-col gap-4">
            {nip65Step.urls.length > 0 && (
              <Nip65Section
                step={nip65Step}
                subjectPubkey={subject.pubkey}
                publish={publishEvent}
                isChecking={true}
              />
            )}
            {simpleSteps
              .filter((s) => s.urls.length > 0)
              .map((step) => (
                <SimpleListSection
                  key={step.kind}
                  step={step}
                  subjectPubkey={subject.pubkey}
                  publish={publishEvent}
                  isChecking={true}
                />
              ))}
          </div>
        )}
        {!isDoneSection && (
          <button
            className="btn btn-ghost btn-sm w-full"
            onClick={() => {
              onDone({ status: "skipped", summary: "Skipped" });
              onContinue();
            }}
          >
            Skip
          </button>
        )}
      </div>
    );
  }

  if (!hasAnyRelays) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <p className="text-sm text-warning">
          No relay lists could be found for this account.
        </p>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({ status: "notfound", summary: "No relay lists found" });
              onContinue();
            }}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  const hasOffline =
    nip65Step.urls.some((u) => nip65Step.verdicts[u] === "offline") ||
    simpleSteps.some((s) => s.urls.some((u) => s.verdicts[u] === "offline"));

  return (
    <div className="flex flex-col gap-4 py-2">
      {isLoading ? (
        <p className="text-xs text-base-content/50">
          Checking relay connectivity…
        </p>
      ) : allCheckedAndHealthy ? (
        <div className="flex items-center gap-2 text-success">
          <svg
            className="size-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-sm font-medium">All relays online</p>
        </div>
      ) : hasOffline ? (
        <p className="text-xs text-warning">
          Some relays are offline — remove them to keep your lists healthy.
        </p>
      ) : (
        <p className="text-xs text-base-content/50">
          Checking relay connectivity…
        </p>
      )}

      {nip65Step.urls.length > 0 && (
        <Nip65Section
          step={nip65Step}
          subjectPubkey={subject.pubkey}
          publish={publishEvent}
          isChecking={isLoading}
        />
      )}
      {simpleSteps
        .filter((s) => s.urls.length > 0)
        .map((step) => (
          <SimpleListSection
            key={step.kind}
            step={step}
            subjectPubkey={subject.pubkey}
            publish={publishEvent}
            isChecking={isLoading}
          />
        ))}

      {isReadOnly && <ReadOnlyBanner />}

      {!isDoneSection && (
        <button className="btn btn-primary btn-sm w-full" onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  );
}

export default ReportContent;
