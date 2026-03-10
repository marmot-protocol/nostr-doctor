import { useEffect, useMemo, useState } from "react";
import type { RelayMonitor } from "applesauce-common/casts";
import type { RelayDiscovery } from "applesauce-common/casts";
import { removeOutboxRelay } from "applesauce-core/operations/mailboxes";
import { use$ } from "applesauce-react/hooks";
import { useApp } from "../../context/AppContext.tsx";
import { eventStore } from "../../lib/store.ts";
import { factory } from "../../lib/factory.ts";
import { monitors$ } from "../../lib/relay-monitors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RelayVerdict = "online" | "offline" | "unknown";

// ---------------------------------------------------------------------------
// Per-relay status from a single monitor
// ---------------------------------------------------------------------------

function useMonitorRelayStatus(
  monitor: RelayMonitor,
  relayUrl: string,
): RelayDiscovery | null | undefined {
  return use$(() => monitor.relayStatus(relayUrl), [monitor.uid, relayUrl]);
}

// ---------------------------------------------------------------------------
// Derive majority-offline verdict across all monitors
// ---------------------------------------------------------------------------

function useRelayVerdict(
  monitors: RelayMonitor[],
  relayUrl: string,
): RelayVerdict {
  // Build one observable per monitor for this relay
  const statuses = monitors.map((m) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMonitorRelayStatus(m, relayUrl);
  });

  return useMemo(() => {
    // Monitors that have emitted a value (not undefined = still loading)
    const loaded = statuses.filter((s) => s !== undefined);
    if (loaded.length === 0) return "unknown";

    // null = monitor has no data for this relay; RelayDiscovery = has data
    const online = loaded.filter(
      (s) => s !== null && s?.rttOpen !== undefined,
    ).length;
    const total = loaded.length;

    if (total === 0) return "unknown";
    if (online > total / 2) return "online";
    return "offline";
  }, [statuses]);
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
// Per-monitor detail row (shown under an offline relay)
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
// RelayRow
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  monitors,
  onRemove,
  removing,
}: {
  relayUrl: string;
  monitors: RelayMonitor[];
  onRemove: (url: string) => void;
  removing: boolean;
}) {
  const verdict = useRelayVerdict(monitors, relayUrl);
  const isOffline = verdict === "offline";

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
        <div className="flex-1 min-w-0">
          <span className="font-mono text-sm break-all">{relayUrl}</span>
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

      {/* Per-monitor detail rows — only shown for offline relays */}
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
// Main page
// ---------------------------------------------------------------------------

function OutboxRelayHealth() {
  const { subject: subjectUser, next, publish: publishEvent } = useApp();

  // Load monitors
  const monitors = use$(monitors$) ?? [];

  // Load user's outbox relays
  const outboxes = use$(
    () => subjectUser?.outboxes$ ?? undefined,
    [subjectUser?.pubkey],
  );

  // Track which relays are being removed
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // The live relay list = outboxes minus already-removed ones
  const relayList = useMemo(
    () => (outboxes ?? []).filter((url) => !removed.has(url)),
    [outboxes, removed],
  );

  // Compute per-relay verdicts at the page level so we can aggregate them
  // without violating hooks rules inside conditionals.
  // We do this by rendering RelayRow which internally calls the hooks — the
  // aggregate is derived from the relay count rather than the per-relay state,
  // so we use a separate aggregation hook below.
  const allLoaded = monitors.length > 0 && outboxes !== undefined;

  // Auto-advance when all relays are confirmed online
  // We detect this through a ref-counted mechanism: each RelayRow reports via
  // onVerdictReady callback pattern — but since hooks can't be called
  // conditionally and we render RelayRows anyway, we track verdicts in state.
  const [verdicts, setVerdicts] = useState<Record<string, RelayVerdict>>({});

  const allHealthy = useMemo(() => {
    if (!allLoaded || relayList.length === 0) return false;
    return relayList.every((url) => verdicts[url] === "online");
  }, [allLoaded, relayList, verdicts]);

  const hasOffline = useMemo(
    () => relayList.some((url) => verdicts[url] === "offline"),
    [relayList, verdicts],
  );

  // Auto-advance when everything is confirmed healthy
  useEffect(() => {
    if (allHealthy) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [allHealthy, next]);

  async function handleRemove(relayUrl: string) {
    if (!subjectUser) return;
    setRemoving((prev) => new Set(prev).add(relayUrl));
    setError(null);
    try {
      const existing = eventStore.getReplaceable(10002, subjectUser.pubkey);
      if (!existing) throw new Error("Could not find your relay list event.");
      const draft = await factory.modify(existing, removeOutboxRelay(relayUrl));
      await publishEvent(draft);
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

  // ---------------------------------------------------------------------------
  // Loading state — monitors or outboxes not yet ready
  // ---------------------------------------------------------------------------
  if (!allLoaded) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your relay list…
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No outbox relays found
  // ---------------------------------------------------------------------------
  if (relayList.length === 0 && removed.size === 0) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                Step 1
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                Outbox Relay Health
              </h1>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
              No NIP-65 outbox relays found for this account. You may want to
              add some before continuing.
            </div>
            <button className="btn btn-primary w-full" onClick={next}>
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // All-clear state (auto-advancing)
  // ---------------------------------------------------------------------------
  if (allHealthy) {
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
                All relays online
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                All {relayList.length} outbox{" "}
                {relayList.length === 1 ? "relay is" : "relays are"} reachable.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main results view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Step 1
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              Outbox Relay Health
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              Checking your NIP-65 outbox relays against{" "}
              {monitors.length === 0
                ? "relay monitors"
                : `${monitors.length} relay monitor${monitors.length === 1 ? "" : "s"}`}
              .
            </p>
          </div>

          {/* Relay list */}
          <div className="flex flex-col gap-3">
            {relayList.map((url) => (
              <VerdictTracker
                key={url}
                relayUrl={url}
                monitors={monitors}
                removing={removing.has(url)}
                onRemove={handleRemove}
                onVerdict={(u, v) =>
                  setVerdicts((prev) =>
                    prev[u] === v ? prev : { ...prev, [u]: v },
                  )
                }
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

          {/* Offline callout */}
          {hasOffline && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-sm text-warning">
              Some of your outbox relays appear offline. Remove them to keep
              your relay list healthy.
            </div>
          )}

          {/* Next button — available once all verdicts are known and no offline remain */}
          <button
            className="btn btn-primary w-full"
            onClick={next}
            disabled={
              hasOffline ||
              relayList.some((u) => verdicts[u] === "unknown" || !verdicts[u])
            }
          >
            {relayList.some((u) => !verdicts[u] || verdicts[u] === "unknown")
              ? "Checking…"
              : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerdictTracker — RelayRow wrapper that reports verdict changes upward
// ---------------------------------------------------------------------------

function VerdictTracker({
  relayUrl,
  monitors,
  removing,
  onRemove,
  onVerdict,
}: {
  relayUrl: string;
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
      monitors={monitors}
      onRemove={onRemove}
      removing={removing}
    />
  );
}

export default OutboxRelayHealth;
