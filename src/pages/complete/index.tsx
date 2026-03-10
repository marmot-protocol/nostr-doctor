import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { useApp } from "../../context/AppContext.tsx";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
import { manager } from "../../lib/accounts.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode an array of EventTemplate objects as base64 JSONL.
 * Each template is serialized as a JSON line; the full string is base64-encoded.
 * Uses encodeURIComponent + escape to safely handle unicode characters.
 */
function encodeReferral(
  drafts: Parameters<typeof JSON.stringify>[0][],
): string {
  const jsonl = drafts.map((e) => JSON.stringify(e)).join("\n");
  return btoa(unescape(encodeURIComponent(jsonl)));
}

// ---------------------------------------------------------------------------
// Branch A: signed in — show published summary
// ---------------------------------------------------------------------------

function PublishedSummary({
  publishedCount,
  onStartOver,
}: {
  publishedCount: number;
  onStartOver: () => void;
}) {
  return (
    <>
      <div>
        <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
          Complete
        </p>
        <h1 className="text-2xl font-semibold text-base-content">All done</h1>
        <p className="text-sm text-base-content/60 mt-1">
          Your diagnostic is complete and changes have been published.
        </p>
      </div>

      <div className="bg-success/10 border border-success/30 rounded-xl p-5 flex flex-col items-center gap-2 text-center">
        <svg
          className="w-8 h-8 text-success"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {publishedCount > 0 ? (
          <p className="text-sm text-base-content/70">
            <span className="font-semibold text-base-content">
              {publishedCount}
            </span>{" "}
            {publishedCount === 1 ? "event" : "events"} published to your outbox
            relays
          </p>
        ) : (
          <p className="text-sm text-base-content/70">
            No changes were needed — your profile looks healthy.
          </p>
        )}
      </div>

      <button className="btn btn-outline w-full" onClick={onStartOver}>
        Start over
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Branch B: read-only, no drafts — nothing to do
// ---------------------------------------------------------------------------

function NoDraftsMessage({ onStartOver }: { onStartOver: () => void }) {
  return (
    <>
      <div>
        <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
          Complete
        </p>
        <h1 className="text-2xl font-semibold text-base-content">All done</h1>
        <p className="text-sm text-base-content/60 mt-1">
          No changes were needed — your profile looks healthy.
        </p>
      </div>

      <div className="bg-success/10 border border-success/30 rounded-xl p-5 flex flex-col items-center gap-2 text-center">
        <svg
          className="w-8 h-8 text-success"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <button className="btn btn-outline w-full" onClick={onStartOver}>
        Start over
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Branch C: read-only, has drafts — sign in or create referral
// ---------------------------------------------------------------------------

function ReadOnlyActions({
  draftCount,
  onCopyReferral,
  copied,
  onStartOver,
}: {
  draftCount: number;
  onCopyReferral: () => void;
  copied: boolean;
  onStartOver: () => void;
}) {
  const navigate = useNavigate();

  return (
    <>
      <div>
        <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
          Complete
        </p>
        <h1 className="text-2xl font-semibold text-base-content">All done</h1>
        <p className="text-sm text-base-content/60 mt-1">
          You were browsing in read-only mode.{" "}
          <span className="font-medium text-base-content">
            {draftCount} {draftCount === 1 ? "fix is" : "fixes are"} ready to
            publish.
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* Option 1: sign in and publish */}
        <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-base-content">
              Sign in to publish
            </p>
            <p className="text-xs text-base-content/50 mt-0.5">
              Signs and publishes your fixes directly from this browser.
            </p>
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={() =>
              navigate(`/signin?redirect=${encodeURIComponent("/complete")}`)
            }
          >
            Sign in
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Option 2: copy referral JSONL */}
        <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-base-content">
              Create a referral
            </p>
            <p className="text-xs text-base-content/50 mt-0.5">
              Copy the unsigned events as base64 JSONL for someone who can
              publish on your behalf.
            </p>
          </div>
          <button
            className={[
              "btn w-full",
              copied ? "btn-success" : "btn-outline",
            ].join(" ")}
            onClick={onCopyReferral}
          >
            {copied ? (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy referral
              </>
            )}
          </button>
        </div>
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

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

function CompleteView() {
  const { events: draftEvents, publishedCount, signer } = useApp();
  const navigate = useNavigate();
  const isReadOnly = signer === null;

  const [copied, setCopied] = useState(false);

  const handleCopyReferral = useCallback(() => {
    const encoded = encodeReferral(draftEvents);
    navigator.clipboard.writeText(encoded).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [draftEvents]);

  function handleStartOver() {
    manager.clearActive();
    subjectPubkey$.next(null);
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {!isReadOnly && (
            <PublishedSummary
              publishedCount={publishedCount}
              onStartOver={handleStartOver}
            />
          )}

          {isReadOnly && draftEvents.length === 0 && (
            <NoDraftsMessage onStartOver={handleStartOver} />
          )}

          {isReadOnly && draftEvents.length > 0 && (
            <ReadOnlyActions
              draftCount={draftEvents.length}
              onCopyReferral={handleCopyReferral}
              copied={copied}
              onStartOver={handleStartOver}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default CompleteView;
