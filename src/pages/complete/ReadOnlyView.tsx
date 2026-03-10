import { useNavigate } from "react-router";
import type { EventTemplate } from "applesauce-core/helpers";
import { CompleteHeader, SuccessBadge } from "./_shared.tsx";

// ---------------------------------------------------------------------------
// ReadOnlyView — no signer present
//
// Two states:
//   - No drafts: all-clear, nothing to publish
//   - Has drafts: prompt to sign in so the orchestrator can route them correctly
//     (self → SelfView to publish, cross-user → /complete/referral to create link)
// ---------------------------------------------------------------------------

function ReadOnlyView({
  draftEvents,
  onStartOver,
}: {
  draftEvents: EventTemplate[];
  onStartOver: () => void;
}) {
  const navigate = useNavigate();
  const hasDrafts = draftEvents.length > 0;

  if (!hasDrafts) {
    return (
      <>
        <CompleteHeader subtitle="No changes were needed — your profile looks healthy." />
        <SuccessBadge />
        <button className="btn btn-outline w-full" onClick={onStartOver}>
          Start over
        </button>
      </>
    );
  }

  const fixes = `${draftEvents.length} ${draftEvents.length === 1 ? "fix" : "fixes"} ready to publish`;

  return (
    <>
      <CompleteHeader
        subtitle={`Diagnostic complete. ${fixes} — sign in to continue.`}
      />

      <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-base-content">
            Sign in to continue
          </p>
          <p className="text-xs text-base-content/50 mt-0.5">
            If you're diagnosing your own account, we'll publish the fixes
            directly. If it's someone else's account, we'll create a shareable
            referral link instead.
          </p>
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            navigate(`/signin?redirect=${encodeURIComponent("/complete")}`)
          }
        >
          Sign in
        </button>
      </div>

      <button
        className="btn btn-ghost btn-sm w-full text-base-content/40"
        onClick={onStartOver}
      >
        Start over
      </button>
    </>
  );
}

export default ReadOnlyView;
