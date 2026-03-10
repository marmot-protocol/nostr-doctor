import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useApp, pagePath } from "../../context/AppContext.tsx";
import { parseReferralParams, decodeReferralJsonl } from "../../lib/blossom.ts";
import REPORTS from "../reports.tsx";

// ---------------------------------------------------------------------------
// States for the fetch / decode lifecycle
// ---------------------------------------------------------------------------

type LoadState = { status: "loading" } | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch a blob from candidate URLs, trying each in order. */
async function fetchFromServers(
  sha256: string,
  servers: string[],
): Promise<string> {
  const errors: string[] = [];

  for (const server of servers) {
    const url = `${server.replace(/\/$/, "")}/${sha256}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${server}: HTTP ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (e) {
      errors.push(
        `${server}: ${e instanceof Error ? e.message : "network error"}`,
      );
    }
  }

  throw new Error(
    `Could not fetch referral from any server.\n${errors.join("\n")}`,
  );
}

// ---------------------------------------------------------------------------
// ReferralView
// ---------------------------------------------------------------------------

function ReferralView() {
  const { sha256 } = useParams<{ sha256: string }>();
  const [searchParams] = useSearchParams();
  const { loadReferral } = useApp();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!sha256) {
      setLoadState({ status: "error", message: "No referral hash provided." });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const parsed = parseReferralParams(sha256!, searchParams);

        if (!parsed) {
          throw new Error("Invalid referral link — sha256 hash is malformed.");
        }
        if (parsed.servers.length === 0) {
          throw new Error("Referral link contains no server hints (xs=).");
        }

        const jsonl = await fetchFromServers(parsed.sha256, parsed.servers);
        const events = decodeReferralJsonl(jsonl);

        if (events.length === 0) {
          throw new Error("Referral bundle is empty.");
        }

        // All events share the same subject pubkey
        const subjectPubkey = events[0].pubkey;
        if (!subjectPubkey || !/^[0-9a-f]{64}$/.test(subjectPubkey)) {
          throw new Error("Referral bundle has invalid or missing pubkey.");
        }

        if (cancelled) return;

        loadReferral(subjectPubkey, events);
        navigate(pagePath(REPORTS[0].name), { replace: true });
      } catch (e) {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load referral.",
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sha256, searchParams, loadReferral, navigate]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loadState.status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col items-center gap-4">
            <span className="loading loading-spinner loading-lg text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium text-base-content">
                Loading referral…
              </p>
              <p className="text-xs text-base-content/50 mt-1">
                Fetching your repair kit from Blossom
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Error
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              Could not load referral
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              The referral link may be expired, corrupted, or the server is
              unreachable.
            </p>
          </div>

          <div className="bg-error/10 border border-error/30 rounded-xl p-4">
            <p className="text-xs text-error font-mono whitespace-pre-wrap break-words">
              {loadState.message}
            </p>
          </div>

          <button
            className="btn btn-outline w-full"
            onClick={() => navigate("/", { replace: true })}
          >
            Back to start
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReferralView;
