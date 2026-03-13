import { Link, Navigate } from "react-router";
import { use$ } from "applesauce-react/hooks";
import { useReport } from "../../context/ReportContext.tsx";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { sectionOutcomes$ } from "../../lib/sectionOutcomes.ts";
import { manager } from "../../lib/accounts.ts";
import doctorLogo from "../../assets/nostr-doctor.webp";
import Footer from "../../components/Footer.tsx";
import SelfView from "./SelfView.tsx";
import ReadOnlyView from "./ReadOnlyView.tsx";

// ---------------------------------------------------------------------------
// CompleteView — orchestrator
//
// Resolves which branch to render based on two orthogonal questions:
//   1. Is there an account? (read-only vs signed-in)
//   2. Is the account the same person as the subject? (self vs cross-user)
//
// All state is read from ReportContext (account) and subjectPubkey$.
// ---------------------------------------------------------------------------

function CompleteView() {
  const { account } = useReport();

  // Stable identity of the person being diagnosed
  const originalSubjectPubkey = use$(subjectPubkey$);

  // Signer pubkey from the active account (same source as context)
  const signerPubkey = account?.pubkey ?? null;

  const draftEvents = use$(draftEvents$);
  const sectionOutcomes = use$(sectionOutcomes$);

  function handleStartOver() {
    // Navigate first so RequireSubject never sees (path=/complete, subject=null).
    // window.location avoids importing useNavigate and ensures a clean exit from
    // the current route tree.
    window.location.href = "/";
    queueMicrotask(() => {
      manager.clearActive();
      subjectPubkey$.next(null);
      draftEvents$.next({});
      sectionOutcomes$.next({});
    });
  }

  const isReadOnly = account === null;
  const isCrossUser =
    !isReadOnly &&
    signerPubkey !== null &&
    signerPubkey !== originalSubjectPubkey;

  const draftArray = Object.values(draftEvents);

  // True if any section had issues but the user skipped without fixing them
  const hasSkippedIssues = Object.values(sectionOutcomes).some(
    (o) => o.status === "skipped",
  );

  // Signed in as someone else — hand off to the dedicated referral flow
  if (isCrossUser) {
    return <Navigate to="/complete/referral" replace />;
  }

  return (
    <div className="min-h-screen bg-base-200 py-8 px-4 flex flex-col items-center gap-0">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        {/* Header — matches accordion page */}
        <div className="flex flex-col items-center text-center gap-4">
          <Link to="/">
            <img
              src={doctorLogo}
              alt="Nostr Doctor logo"
              className="w-40 h-auto sm:w-44"
            />
          </Link>
        </div>

        {/* Summary card */}
        <div className="bg-base-100 rounded-2xl border border-base-content/15 p-8 shadow-md flex flex-col gap-6">
          {isReadOnly ? (
            <ReadOnlyView
              draftEvents={draftArray}
              hasSkippedIssues={hasSkippedIssues}
              onStartOver={handleStartOver}
              subjectPubkey={originalSubjectPubkey ?? ""}
            />
          ) : (
            <SelfView
              draftEvents={draftArray}
              hasSkippedIssues={hasSkippedIssues}
              onStartOver={handleStartOver}
            />
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}

export default CompleteView;
