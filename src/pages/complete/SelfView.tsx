import { useState } from "react";
import type { NostrEvent } from "applesauce-core/helpers";
import { useReport } from "../../context/ReportContext.tsx";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { CompleteHeader, SuccessBadge } from "./_shared.tsx";

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

  async function handlePublish() {
    setState({ status: "publishing" });
    try {
      await Promise.all(draftEvents.map((t) => publish(t)));
      // Clear drafts now that they're published
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
          {draftEvents.length}{" "}
          {draftEvents.length === 1 ? "fix was" : "fixes were"} collected while
          you were in read-only mode.
        </p>
      </div>
      {state.status === "error" && (
        <p className="text-xs text-error">{state.message}</p>
      )}
      <button
        className="btn btn-primary w-full"
        onClick={handlePublish}
        disabled={state.status === "publishing"}
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
