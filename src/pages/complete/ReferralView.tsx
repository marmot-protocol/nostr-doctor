import { useState, useCallback } from "react";
import { useNavigate, Navigate } from "react-router";
import { firstValueFrom, timeout, catchError, of } from "rxjs";
import { UserBlossomServersModel } from "applesauce-common/models";
import type { EventTemplate } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { useReport } from "../../context/ReportContext.tsx";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { eventStore } from "../../lib/store.ts";
import {
  createReferralLink,
  DEFAULT_BLOSSOM_SERVERS,
} from "../../lib/blossom.ts";
import { CompleteHeader } from "./_shared.tsx";

// ---------------------------------------------------------------------------
// useReferralLink hook
// ---------------------------------------------------------------------------

type LinkState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; url: string }
  | { status: "error"; message: string };

function useReferralLink(draftEvents: EventTemplate[], subjectPubkey: string) {
  const { account } = useReport();
  const [linkState, setLinkState] = useState<LinkState>({ status: "idle" });

  const createLink = useCallback(async () => {
    if (!account) return;
    setLinkState({ status: "loading" });
    try {
      const uploaderPubkey = await account.signer.getPublicKey();
      const serverUrls = await firstValueFrom(
        eventStore.model(UserBlossomServersModel, uploaderPubkey).pipe(
          timeout(3000),
          catchError(() => of(undefined)),
        ),
      );
      const servers =
        serverUrls && serverUrls.length > 0
          ? serverUrls.map((u) => u.toString())
          : DEFAULT_BLOSSOM_SERVERS;

      const url = await createReferralLink(
        draftEvents,
        subjectPubkey,
        account.signer,
        servers,
      );
      setLinkState({ status: "success", url });
    } catch (e) {
      setLinkState({
        status: "error",
        message:
          e instanceof Error ? e.message : "Failed to create referral link.",
      });
    }
  }, [account, draftEvents, subjectPubkey]);

  const reset = useCallback(() => setLinkState({ status: "idle" }), []);

  return { linkState, createLink, reset };
}

// ---------------------------------------------------------------------------
// ReferralView — /complete/referral
//
// Requires a signer. If none is present, redirects to sign-in with a return
// path back here. ReportContext orchestrator routes here only when
// signer ≠ subject, so we can assume cross-user context.
// ---------------------------------------------------------------------------

function ReferralView() {
  const navigate = useNavigate();
  const { account } = useReport();

  // subjectPubkey$ holds the original subject (the person being diagnosed).
  // After sign-in, ReportContext.subject switches to the signer's identity,
  // so we must read subjectPubkey$ directly here.
  const rawSubjectPubkey = use$(subjectPubkey$);
  const subjectPubkey = rawSubjectPubkey ?? "";

  // Read draftEvents from the BehaviorSubject directly
  const draftEvents = use$(draftEvents$);

  const { linkState, createLink, reset } = useReferralLink(
    draftEvents,
    subjectPubkey,
  );
  const [copied, setCopied] = useState(false);

  // Guard: no account — redirect to sign-in with return path to this page.
  // All hooks are called above this early return to satisfy rules-of-hooks.
  if (!account) {
    return (
      <Navigate
        to={`/signin?redirect=${encodeURIComponent("/complete/referral")}`}
        replace
      />
    );
  }

  function handleCopy(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <CompleteHeader subtitle="Upload the repair kit to Blossom and share the link with the account owner." />

      {/* Link creation */}
      <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-base-content">
            Create a referral link
          </p>
          <p className="text-xs text-base-content/50 mt-0.5">
            Packages{" "}
            {draftEvents.length === 0
              ? "the diagnostic results"
              : `${draftEvents.length} ${draftEvents.length === 1 ? "fix" : "fixes"}`}{" "}
            into a Blossom blob the account owner can load and sign.
          </p>
        </div>

        {linkState.status === "idle" && (
          <button className="btn btn-primary w-full" onClick={createLink}>
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
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            Create link
          </button>
        )}

        {linkState.status === "loading" && (
          <button className="btn btn-primary w-full" disabled>
            <span className="loading loading-spinner loading-sm" />
            Uploading to Blossom…
          </button>
        )}

        {linkState.status === "success" && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={linkState.url}
                className="input input-sm flex-1 font-mono text-xs bg-base-100"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className={[
                  "btn btn-sm",
                  copied ? "btn-success" : "btn-outline",
                ].join(" ")}
                onClick={() => handleCopy(linkState.url)}
              >
                {copied ? (
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
                ) : (
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
                )}
              </button>
            </div>
            <p className="text-xs text-base-content/40">
              Send this link to the account owner so they can sign and publish
              the fixes.
            </p>
          </div>
        )}

        {linkState.status === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-error">{linkState.message}</p>
            <button className="btn btn-outline btn-sm w-full" onClick={reset}>
              Try again
            </button>
          </div>
        )}
      </div>

      <button
        className="btn btn-ghost btn-sm w-full text-base-content/40"
        onClick={() => navigate("/complete")}
      >
        Back
      </button>
    </>
  );
}

export default ReferralView;
