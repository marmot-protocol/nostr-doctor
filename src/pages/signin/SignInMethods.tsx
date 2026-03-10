import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { qrcode } from "@libs/qrcode";
import {
  ExtensionMissingError,
  NostrConnectSigner,
} from "applesauce-signers/signers";
import {
  ExtensionAccount,
  NostrConnectAccount,
} from "applesauce-accounts/accounts";
import { manager } from "../../lib/accounts.ts";
import { DEFAULT_RELAY_FOR_REMOTE_SIGNER_QR, pool } from "../../lib/relay.ts";
import { getSafeRedirect, REPORT_PAGE_BASE } from "../../lib/routing.ts";

// Wire NostrConnectSigner to use our shared RelayPool once at module load
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

function addAndActivate(account: ExtensionAccount | NostrConnectAccount) {
  manager.addAccount(account);
  manager.setActive(account);
}

// ---------------------------------------------------------------------------
// Main sign-in page — QR first, extension inline, more options collapsed
// ---------------------------------------------------------------------------

function SignInMethods() {
  const navigate = useNavigate();
  const location = useLocation();
  const qs = location.search ?? "";
  const redirectTo = getSafeRedirect(location.search);

  function handleSignedIn() {
    navigate(redirectTo ?? REPORT_PAGE_BASE);
  }

  // --- QR / Nostr Connect ---
  const [svgMarkup, setSvgMarkup] = useState("");
  const [qrError, setQrError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let signerInstance: NostrConnectSigner | null = null;

    async function init() {
      try {
        signerInstance = new NostrConnectSigner({
          relays: [DEFAULT_RELAY_FOR_REMOTE_SIGNER_QR],
        });
        const uri = signerInstance.getNostrConnectURI({ name: "Nostr Doctor" });
        if (cancelled) return;
        setSvgMarkup(qrcode(uri, { output: "svg" }));
        await signerInstance.waitForSigner();
        if (cancelled) return;
        const pubkey = await signerInstance.getPublicKey();
        if (cancelled) return;
        const account = new NostrConnectAccount(pubkey, signerInstance);
        addAndActivate(account);
        handleSignedIn();
      } catch (err) {
        if (!cancelled)
          setQrError(err instanceof Error ? err.message : "Connection failed.");
      }
    }

    init();
    return () => {
      cancelled = true;
      signerInstance?.close();
    };
    // handleSignedIn is derived from stable refs — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Extension ---
  const [extLoading, setExtLoading] = useState(false);
  const [extError, setExtError] = useState("");

  async function connectExtension() {
    setExtLoading(true);
    setExtError("");
    try {
      const account = await ExtensionAccount.fromExtension();
      addAndActivate(account);
      handleSignedIn();
    } catch (err) {
      if (err instanceof ExtensionMissingError) {
        setExtError(
          "No Nostr browser extension found. Install Alby or nos2x and try again.",
        );
      } else {
        setExtError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setExtLoading(false);
    }
  }

  // --- More options toggle ---
  const [showMore, setShowMore] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Back */}
      <button
        type="button"
        className="btn btn-ghost btn-sm gap-1 -ml-2 -mb-2 text-base-content/40 self-start"
        onClick={() => navigate(`/${qs}`)}
      >
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
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back
      </button>

      {/* QR section */}
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-xl font-semibold text-base-content self-start">
          Sign in
        </h1>
        <p className="text-base-content/50 text-sm self-start">
          Scan with Amber, Nsec.app, or any NIP-46 signer app.
        </p>

        {qrError && <p className="text-error text-sm w-full">{qrError}</p>}

        {!qrError && !svgMarkup && (
          <div className="flex items-center justify-center py-10">
            <span className="loading loading-spinner loading-lg" />
          </div>
        )}

        {svgMarkup && (
          <>
            <div
              className="rounded-xl overflow-hidden border border-base-300"
              style={{ width: 220, height: 220 }}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
            <p className="text-xs text-base-content/40">
              Waiting for approval…
            </p>
          </>
        )}

        {/* Customize link */}
        <button
          type="button"
          className="text-xs text-base-content/40 hover:text-base-content/70 transition-colors underline underline-offset-2"
          onClick={() => navigate(`/signin/bunker${qs}`)}
        >
          Use a relay URL or paste a bunker URI instead
        </button>
      </div>

      <div className="divider my-0" />

      {/* Extension */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-outline w-full"
          onClick={connectExtension}
          disabled={extLoading}
        >
          {extLoading ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            "Sign in with browser extension"
          )}
        </button>
        {extError && <p className="text-error text-xs">{extError}</p>}
      </div>

      <div className="divider my-0" />

      {/* More options */}
      <div className="flex flex-col">
        <button
          type="button"
          className="flex items-center justify-between py-1 hover:opacity-70 transition-opacity text-left"
          onClick={() => setShowMore((v) => !v)}
        >
          <span className="text-sm text-base-content/60">More options</span>
          <svg
            className={[
              "w-4 h-4 text-base-content/30 transition-transform",
              showMore ? "rotate-90" : "",
            ]
              .filter(Boolean)
              .join(" ")}
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

        {showMore && (
          <div className="flex flex-col mt-1">
            {(
              [
                {
                  id: "privatekey",
                  label: "Private key",
                  description: "nsec or hex — memory only",
                },
                {
                  id: "password",
                  label: "Encrypted key (NIP-49)",
                  description: "ncryptsec + password",
                },
              ] as const
            ).map(({ id, label, description }) => (
              <button
                key={id}
                type="button"
                className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity text-left border-t border-base-200"
                onClick={() => navigate(`/signin/${id}${qs}`)}
              >
                <div>
                  <div className="text-sm font-medium text-base-content">
                    {label}
                  </div>
                  <div className="text-xs text-base-content/40 mt-0.5">
                    {description}
                  </div>
                </div>
                <svg
                  className="w-4 h-4 text-base-content/20 shrink-0 ml-3"
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SignInMethods;
