import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router";
import { use$ } from "applesauce-react/hooks";
import { useApp } from "../../context/AppContext.tsx";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
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
// Cross-user: immediately Navigate to /complete/referral — that page owns
// the referral link creation flow and also carries the sign-in guard.
//
// State survival guarantee:
//   - draftEvents lives in AppProvider (above the route tree) — survives sign-in
//   - subjectPubkey$ is a module-level BehaviorSubject — survives sign-in
//   - After sign-in, AppContext.subject switches to the signer's pubkey, so we
//     MUST read the original subject from subjectPubkey$ directly for comparison
// ---------------------------------------------------------------------------

function CompleteView() {
  const navigate = useNavigate();
  const { events: draftEvents, publishedCount, signer } = useApp();

  // The original subject being diagnosed — stable across sign-in.
  // DO NOT use subject!.pubkey here: after sign-in that resolves to the signer's
  // pubkey, not the person that was entered on the pubkey step.
  const originalSubjectPubkey = use$(subjectPubkey$);

  // Resolve the signer's own pubkey asynchronously so we can compare it to the
  // subject. signerPubkeyResolved prevents briefly flashing the wrong branch
  // while getPublicKey() is in-flight.
  const [signerPubkey, setSignerPubkey] = useState<string | null>(null);
  const [signerPubkeyResolved, setSignerPubkeyResolved] = useState(false);

  useEffect(() => {
    if (!signer) return;
    let cancelled = false;
    signer
      .getPublicKey()
      .then((pk) => {
        if (cancelled) return;
        setSignerPubkey(pk);
        setSignerPubkeyResolved(true);
      })
      .catch(() => {
        if (!cancelled) setSignerPubkeyResolved(true);
      });
    return () => {
      cancelled = true;
      // Reset resolution state when signer changes so the next signer starts fresh
      setSignerPubkey(null);
      setSignerPubkeyResolved(false);
    };
  }, [signer]);

  function handleStartOver() {
    // Navigate first so RequireSubject never sees (path=/complete, subject=null).
    navigate("/", { replace: true });
    queueMicrotask(() => {
      manager.clearActive();
      subjectPubkey$.next(null);
    });
  }

  const isReadOnly = signer === null;
  const isResolvingSigner = !isReadOnly && !signerPubkeyResolved;
  const isCrossUser =
    !isReadOnly &&
    signerPubkeyResolved &&
    signerPubkey !== null &&
    signerPubkey !== originalSubjectPubkey;

  // Waiting for async signer pubkey resolution — avoid flashing the wrong branch
  if (isResolvingSigner) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

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
            <SelfView
              publishedCount={publishedCount}
              draftEvents={draftEvents}
              onStartOver={handleStartOver}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default CompleteView;
