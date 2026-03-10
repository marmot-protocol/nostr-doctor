import { Navigate } from "react-router";
import { use$ } from "applesauce-react/hooks";
import { ReadonlyAccount } from "applesauce-accounts/accounts";
import { useReport } from "../../context/ReportContext.tsx";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { manager } from "../../lib/accounts.ts";
import SelfView from "./SelfView.tsx";
import ReadOnlyView from "./ReadOnlyView.tsx";

// ---------------------------------------------------------------------------
// CompleteView — orchestrator
//
// Resolves which branch to render based on two orthogonal questions:
//   1. Is there a signer? (read-only vs signed-in)
//   2. Is the signer the same person as the subject? (self vs cross-user)
//
// All state is read from BehaviorSubjects — no async useEffect races.
// manager.active$ is a BehaviorSubject that always holds the current account
// synchronously, so signerPubkey is available without getPublicKey().
// ---------------------------------------------------------------------------

function CompleteView() {
  const { signer } = useReport();

  // Stable identity of the person being diagnosed
  const originalSubjectPubkey = use$(subjectPubkey$);

  // Active account — synchronous BehaviorSubject. ReadonlyAccount has a pubkey
  // but no real signer, so we exclude it when determining the signer identity.
  const activeAccount = use$(manager.active$);
  const signerPubkey =
    activeAccount && !(activeAccount instanceof ReadonlyAccount)
      ? activeAccount.pubkey
      : null;

  const draftEvents = use$(draftEvents$);

  function handleStartOver() {
    // Navigate first so RequireSubject never sees (path=/complete, subject=null).
    // window.location avoids importing useNavigate and ensures a clean exit from
    // the current route tree.
    window.location.href = "/";
    queueMicrotask(() => {
      manager.clearActive();
      subjectPubkey$.next(null);
      draftEvents$.next([]);
    });
  }

  const isReadOnly = signer === null;
  const isCrossUser =
    !isReadOnly &&
    signerPubkey !== null &&
    signerPubkey !== originalSubjectPubkey;

  // Signed in as someone else — hand off to the dedicated referral flow
  if (isCrossUser) {
    return <Navigate to="/complete/referral" replace />;
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {isReadOnly ? (
            <ReadOnlyView
              draftEvents={draftEvents}
              onStartOver={handleStartOver}
            />
          ) : (
            <SelfView draftEvents={draftEvents} onStartOver={handleStartOver} />
          )}
        </div>
      </div>
    </div>
  );
}

export default CompleteView;
