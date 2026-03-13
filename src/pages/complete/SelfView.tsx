import { useState } from "react";
import type { NostrEvent } from "applesauce-core/helpers";
import { getEventUID } from "applesauce-core/helpers";
import { useReport } from "../../context/ReportContext.tsx";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { CompleteHeader, SuccessBadge } from "./_shared.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(kind: number): string {
  switch (kind) {
    case 0: return "Profile metadata";
    case 3: return "Follow list";
    case 5: return "Event deletion";
    case 10002: return "Relay list (NIP-65)";
    case 10006: return "Blocked relays";
    case 10007: return "Search relays";
    case 10012: return "Favorite relays";
    case 10050: return "DM relays";
    case 10051: return "Key package relays";
    default: return `Kind ${kind}`;
  }
}

function kindBadgeClass(kind: number): string {
  if (kind === 5) return "badge-error";
  if (kind === 0 || kind === 3) return "badge-secondary";
  return "badge-ghost";
}

// ---------------------------------------------------------------------------
// DraftEventRow
// ---------------------------------------------------------------------------

function DraftEventRow({
  event,
  onRemove,
}: {
  event: NostrEvent;
  onRemove: () => void;
}) {
  const uid = getEventUID(event);
  const label = kindLabel(event.kind);
  const badgeClass = kindBadgeClass(event.kind);

  // For kind:5 deletions, show which event is being deleted
  const deletedIds = event.kind === 5
    ? event.tags.filter((t) => t[0] === "e").map((t) => t[1])
    : [];

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-base-200 last:border-0">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={["badge badge-xs font-mono", badgeClass].join(" ")}>
            kind:{event.kind}
          </span>
          <span className="text-sm text-base-content">{label}</span>
        </div>
        {deletedIds.length > 0 && (
          <p className="text-xs text-base-content/40 font-mono truncate">
            deletes {deletedIds[0].slice(0, 12)}…
            {deletedIds.length > 1 && ` +${deletedIds.length - 1} more`}
          </p>
        )}
        {event.kind !== 5 && (
          <p className="text-xs text-base-content/40 font-mono truncate">
            {uid.slice(0, 24)}…
          </p>
        )}
      </div>
      <button
        className="btn btn-ghost btn-xs text-base-content/40 hover:text-error hover:bg-error/10 shrink-0 mt-0.5"
        onClick={onRemove}
        aria-label={`Remove ${label} from queue`}
        title="Remove from queue"
      >
        <svg
          className="size-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PublishDraftsCard
// ---------------------------------------------------------------------------

type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "done" }
  | { status: "error"; message: string };

function PublishDraftsCard({ draftEvents }: { draftEvents: NostrEvent[] }) {
  const { publish } = useReport();
  const [state, setState] = useState<PublishState>({ status: "idle" });

  function handleRemove(event: NostrEvent) {
    const uid = getEventUID(event);
    const current = draftEvents$.getValue();
    const next = { ...current };
    delete next[uid];
    draftEvents$.next(next);
  }

  async function handlePublish() {
    setState({ status: "publishing" });
    try {
      await Promise.all(draftEvents.map((t) => publish(t)));
      draftEvents$.next({});
      setState({ status: "done" });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Publish failed.",
      });
    }
  }

  if (state.status === "done") {
    return (
      <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
        <p className="text-sm text-base-content/70">
          All fixes published to your outbox relays.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-base-content">
          Pending fixes ready to publish
        </p>
        <p className="text-xs text-base-content/50 mt-0.5">
          Review and remove any you don't want, then publish the rest.
        </p>
      </div>

      {/* Draft list */}
      <div className="bg-base-100 rounded-lg px-3 py-1 flex flex-col">
        {draftEvents.map((event) => (
          <DraftEventRow
            key={getEventUID(event)}
            event={event}
            onRemove={() => handleRemove(event)}
          />
        ))}
      </div>

      {state.status === "error" && (
        <p className="text-xs text-error">{state.message}</p>
      )}

      <button
        className="btn btn-primary w-full"
        onClick={handlePublish}
        disabled={state.status === "publishing" || draftEvents.length === 0}
      >
        {state.status === "publishing" ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Publishing…
          </>
        ) : (
          `Publish ${draftEvents.length} ${draftEvents.length === 1 ? "fix" : "fixes"}`
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelfView — signed in as the subject being diagnosed
// ---------------------------------------------------------------------------

function SelfView({
  draftEvents,
  hasSkippedIssues,
  onStartOver,
}: {
  draftEvents: NostrEvent[];
  hasSkippedIssues: boolean;
  onStartOver: () => void;
}) {
  const hasDrafts = draftEvents.length > 0;

  const subtitle = hasDrafts
    ? `Your diagnostic is complete. ${draftEvents.length} ${draftEvents.length === 1 ? "fix is" : "fixes are"} ready to publish.`
    : "Your diagnostic is complete.";

  return (
    <>
      <CompleteHeader subtitle={subtitle} />

      {!hasDrafts && !hasSkippedIssues && (
        <SuccessBadge>
          <p className="text-sm text-base-content/70">
            No changes were needed — your profile looks healthy.
          </p>
        </SuccessBadge>
      )}

      {!hasDrafts && hasSkippedIssues && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5 flex flex-col gap-2">
          <p className="text-sm font-medium text-base-content">
            Suggested changes were skipped
          </p>
          <p className="text-sm text-base-content/60">
            Some issues were found during the diagnostic but no fixes were
            selected. Go back to review and apply the suggested changes.
          </p>
          <button
            className="btn btn-warning btn-sm mt-1 self-start"
            onClick={() => window.history.back()}
          >
            Go back
          </button>
        </div>
      )}

      {hasDrafts && <PublishDraftsCard draftEvents={draftEvents} />}

      <button className="btn btn-outline w-full" onClick={onStartOver}>
        Start over
      </button>
    </>
  );
}

export default SelfView;
