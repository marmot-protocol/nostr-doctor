import { useEffect, useRef, useState } from "react";
import type { EventTemplate } from "applesauce-core/helpers";
import { buildLegacyCleanup } from "../../../lib/marmot/legacy-cleanup.ts";
import { AUTO_ADVANCE_MS } from "../../../lib/timeouts.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { LegacyCleanupState } from "./loader.ts";

function ReportContent({
  subject,
  account,
  loaderState,
  publish,
  onDone,
  onContinue,
  isActive,
  isDoneSection,
}: SectionProps<LegacyCleanupState>) {
  const state = loaderState?.data;
  const isLoading = !loaderState?.complete;
  const events = state?.events ?? [];
  const incomplete =
    !state ||
    state.incompleteRelays.length > 0 ||
    state.invalidRelayUrls.length > 0;
  const [reported, setReported] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<EventTemplate[] | null>(null);

  useEffect(() => {
    if (isLoading || reported) return;
    setReported(true);
    onDone({
      status: events.length || incomplete ? "warning" : "clean",
      summary: events.length
        ? `${events.length} legacy event(s) available for cleanup`
        : incomplete
          ? "Legacy search incomplete"
          : "No legacy data observed",
    });
    // The accordion callbacks change identity on every report update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    if (
      !isActive ||
      isDoneSection ||
      isLoading ||
      (!done && (events.length > 0 || incomplete))
    )
      return;
    const timer = setTimeout(onContinue, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [
    isActive,
    isDoneSection,
    isLoading,
    done,
    events.length,
    incomplete,
    onContinue,
  ]);

  async function cleanup() {
    setPublishing(true);
    setError(null);
    try {
      pending.current ??= await buildLegacyCleanup(events, subject.pubkey);
      const requests = pending.current;
      // Every independent batch is attempted; retries only repeat failed batches.
      const results = await Promise.allSettled(
        requests.map((request) => publish(request)),
      );
      pending.current = requests.filter(
        (_, index) => results[index].status === "rejected",
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        const reason = failures[0].reason;
        throw new Error(
          `${failures.length} deletion request(s) need retry. ${reason instanceof Error ? reason.message : "Publishing failed."}`,
        );
      }
      const summary = account
        ? "Legacy deletion requests submitted"
        : "Legacy deletion requests queued";
      setDone(summary);
      onDone({
        status: incomplete ? "warning" : "fixed",
        summary: incomplete ? `${summary}; search incomplete` : summary,
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not prepare legacy cleanup.";
      setError(message);
      onDone({ status: "error", summary: "Legacy cleanup needs retry" });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {isLoading && (
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm">Searching for legacy Marmot data…</p>
        </div>
      )}
      <p className="text-sm text-base-content/70">
        Old kind 443 KeyPackages and kind 10051 KeyPackage relay lists are
        obsolete. You can request deletion of every legacy event found here.
      </p>
      {events.length > 0 && (
        <>
          <div className="rounded-xl bg-base-200 p-4 text-sm">
            <p>
              {events.filter(({ event }) => event.kind === 443).length} old
              KeyPackage(s) ·{" "}
              {events.filter(({ event }) => event.kind === 10051).length} old
              relay-list event(s)
            </p>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer">View legacy events</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {events.map(({ event, foundOnRelays }) => (
                <li
                  key={event.id}
                  className="rounded-lg border border-base-200 p-3"
                >
                  <p>Kind {event.kind}</p>
                  <p className="font-mono break-all">{event.id}</p>
                  <p className="text-base-content/60 break-all">
                    Found on: {foundOnRelays.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {!isLoading && events.length === 0 && (
        <p className="text-sm">
          {incomplete
            ? "No legacy events observed before the search ended."
            : "No legacy events found on the relays checked."}
        </p>
      )}
      {!isLoading && incomplete && (
        <p className="alert alert-warning text-sm">
          Some relays could not be fully checked or their URLs were invalid.
          Cleanup covers the events found so far; run Doctor again to check for
          remaining copies.
        </p>
      )}
      <p className="text-xs text-base-content/60">
        Current kind 30443 KeyPackages and kind 10050 inbox relays are kept.
        Deletion requests are sent to the relays holding the legacy events;
        relays may retain copies.
      </p>
      {done && (
        <p className="alert alert-success text-sm">
          {done}.{!account && " Sign in at the final step to publish them."}
        </p>
      )}
      {error && <p className="text-error text-sm">{error}</p>}
      {!isDoneSection && (
        <div className="flex flex-col gap-2">
          {!isLoading && !done && events.length > 0 && (
            <button
              className="btn btn-error"
              disabled={publishing}
              onClick={() => void cleanup()}
            >
              {publishing
                ? "Submitting…"
                : error
                  ? "Retry legacy cleanup"
                  : account
                    ? "Delete all legacy data"
                    : "Queue deletion of all legacy data"}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            disabled={publishing}
            onClick={() => {
              if (!done && (isLoading || events.length > 0))
                onDone({
                  status: "skipped",
                  summary: "Legacy cleanup skipped",
                });
              onContinue();
            }}
          >
            {done || (!isLoading && events.length === 0) ? "Continue" : "Skip"}
          </button>
        </div>
      )}
    </div>
  );
}

export default ReportContent;
