import { useState } from "react";
import type { EventTemplate } from "applesauce-core/helpers";
import { useApp } from "../../context/AppContext.tsx";
import { CompleteHeader, SuccessBadge } from "./_shared.tsx";

// ---------------------------------------------------------------------------
// PublishDraftsCard
// ---------------------------------------------------------------------------

type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "done"; count: number }
  | { status: "error"; message: string };

function PublishDraftsCard({ draftEvents }: { draftEvents: EventTemplate[] }) {
  const { publish } = useApp();
  const [state, setState] = useState<PublishState>({ status: "idle" });

  async function handlePublish() {
    setState({ status: "publishing" });
    try {
      await Promise.all(draftEvents.map((t) => publish(t)));
      setState({ status: "done", count: draftEvents.length });
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
          <span className="font-semibold text-base-content">{state.count}</span>{" "}
          {state.count === 1 ? "fix" : "fixes"} published to your outbox relays.
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
  publishedCount,
  draftEvents,
  onStartOver,
}: {
  publishedCount: number;
  draftEvents: EventTemplate[];
  onStartOver: () => void;
}) {
  const hasDrafts = draftEvents.length > 0;

  const subtitle = hasDrafts
    ? `Your diagnostic is complete. ${draftEvents.length} ${draftEvents.length === 1 ? "fix is" : "fixes are"} ready to publish.`
    : publishedCount > 0
      ? "Your diagnostic is complete and changes have been published."
      : "Your diagnostic is complete.";

  return (
    <>
      <CompleteHeader subtitle={subtitle} />

      {!hasDrafts && (
        <SuccessBadge>
          {publishedCount > 0 ? (
            <p className="text-sm text-base-content/70">
              <span className="font-semibold text-base-content">
                {publishedCount}
              </span>{" "}
              {publishedCount === 1 ? "event" : "events"} published to your
              outbox relays
            </p>
          ) : (
            <p className="text-sm text-base-content/70">
              No changes were needed — your profile looks healthy.
            </p>
          )}
        </SuccessBadge>
      )}

      {hasDrafts && <PublishDraftsCard draftEvents={draftEvents} />}

      <button className="btn btn-outline w-full" onClick={onStartOver}>
        Start over
      </button>
    </>
  );
}

export default SelfView;
