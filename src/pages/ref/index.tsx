import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { firstValueFrom } from "rxjs";
import { getOutboxes } from "applesauce-core/helpers";
import type { EventTemplate } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { ReadonlyAccount } from "applesauce-accounts/accounts";
import { parseReferralParams, decodeReferralJsonl } from "../../lib/blossom.ts";
import {
  referralPack$,
  type DecodedReferralPack,
} from "../../lib/referralPack.ts";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
import { manager } from "../../lib/accounts.ts";
import { pool, DEFAULT_RELAYS, LOOKUP_RELAYS } from "../../lib/relay.ts";

// ---------------------------------------------------------------------------
// Kind label map — human-readable descriptions for common event kinds
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<number, string> = {
  0: "Profile metadata",
  3: "Follow list",
  10002: "Relay list (NIP-65)",
  10063: "Blossom server list",
};

function kindLabel(kind: number): string {
  return KIND_LABELS[kind] ?? `kind:${kind}`;
}

// ---------------------------------------------------------------------------
// Phase state machine
// ---------------------------------------------------------------------------

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "summary" }
  | { name: "publishing" }
  | { name: "done" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch a blob from candidate Blossom servers, trying each in order. */
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

/**
 * Resolve outbox relays for a pubkey by fetching their kind:10002 event.
 * Falls back to DEFAULT_RELAYS if not found within 5 seconds.
 */
async function resolveOutboxRelays(pubkey: string): Promise<string[]> {
  try {
    const event = await firstValueFrom(
      pool.request([...LOOKUP_RELAYS, ...DEFAULT_RELAYS], {
        kinds: [10002],
        authors: [pubkey],
        limit: 1,
      }),
    );
    const outboxes = getOutboxes(event);
    if (outboxes && outboxes.length > 0) return outboxes;
  } catch {
    // timeout or no event found — fall through to default
  }
  return DEFAULT_RELAYS;
}

// ---------------------------------------------------------------------------
// EventCard — shows kind label + collapsible raw JSON
// ---------------------------------------------------------------------------

function EventCard({ event }: { event: EventTemplate & { pubkey: string } }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-base-200 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-base-200/50 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="badge badge-ghost badge-sm font-mono">
            {event.kind}
          </span>
          <span className="text-sm font-medium text-base-content">
            {kindLabel(event.kind)}
          </span>
        </div>
        <svg
          className={[
            "w-4 h-4 text-base-content/30 transition-transform shrink-0",
            open ? "rotate-90" : "",
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
      {open && (
        <div className="px-4 pb-4 border-t border-base-200">
          <pre className="text-xs text-base-content/60 overflow-x-auto mt-3 whitespace-pre-wrap break-all">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReferralPage
// ---------------------------------------------------------------------------

function ReferralPage() {
  const { sha256 } = useParams<{ sha256: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read BehaviorSubjects — synchronous, no useEffect race
  const pack = use$(referralPack$);
  // Derive isSignedIn from manager.active$ — a BehaviorSubject, always current.
  // ReadonlyAccount has a pubkey but no signer; exclude it.
  const activeAccount = use$(manager.active$);
  const isSignedIn =
    activeAccount !== undefined && !(activeAccount instanceof ReadonlyAccount);

  const [phase, setPhase] = useState<Phase>(() => {
    // If we already have the pack cached (returning from sign-in), skip loading
    if (pack && pack.sha256 === sha256) return { name: "summary" };
    return { name: "loading" };
  });

  // ---------------------------------------------------------------------------
  // Fetch + decode on mount (or when sha256 changes)
  // Skip if the pack is already cached for this sha256
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!sha256) {
      setPhase({ name: "error", message: "No referral hash provided." });
      return;
    }

    // Already have this pack cached — no need to re-fetch
    if (pack && pack.sha256 === sha256) {
      setPhase({ name: "summary" });
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

        const subjectPubkey = events[0].pubkey;
        if (!subjectPubkey || !/^[0-9a-f]{64}$/.test(subjectPubkey)) {
          throw new Error("Referral bundle has invalid or missing pubkey.");
        }

        if (cancelled) return;

        // Store decoded pack and wire up shared state
        const decoded: DecodedReferralPack = {
          sha256: parsed.sha256,
          subjectPubkey,
          events,
        };
        referralPack$.next(decoded);
        draftEvents$.next(events);
        subjectPubkey$.next(subjectPubkey);

        setPhase({ name: "summary" });
      } catch (e) {
        if (cancelled) return;
        setPhase({
          name: "error",
          message: e instanceof Error ? e.message : "Failed to load referral.",
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sha256]);

  // ---------------------------------------------------------------------------
  // Sign-in redirect — preserves full current URL (path + all query params)
  // ---------------------------------------------------------------------------
  function handleSignIn() {
    const currentPath = window.location.pathname + window.location.search;
    navigate(`/signin?redirect=${encodeURIComponent(currentPath)}`);
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------
  async function handlePublish() {
    const currentPack = referralPack$.getValue();
    if (!currentPack || !manager.signer) return;

    setPhase({ name: "publishing" });
    try {
      const relays = await resolveOutboxRelays(currentPack.subjectPubkey);

      for (const event of currentPack.events) {
        const signed = await manager.signer.signEvent(event);
        await pool.publish(relays, signed);
      }

      // Clear shared state
      draftEvents$.next([]);
      referralPack$.next(null);
      subjectPubkey$.next(null);

      setPhase({ name: "done" });
    } catch (e) {
      setPhase({
        name: "error",
        message: e instanceof Error ? e.message : "Publish failed.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (phase.name === "loading") {
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
  if (phase.name === "error") {
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
                {phase.message}
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

  // ---------------------------------------------------------------------------
  // Done state
  // ---------------------------------------------------------------------------
  if (phase.name === "done") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <svg
                className="size-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-base-content">
                Fixes published
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                All events have been signed and published to your relays.
              </p>
            </div>
            <button
              className="btn btn-outline w-full"
              onClick={() => navigate("/", { replace: true })}
            >
              Check another account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Summary state — show fix list, sign-in or publish button
  // pack is guaranteed non-null here (we only reach summary after setting it)
  // ---------------------------------------------------------------------------
  const currentPack = pack ?? referralPack$.getValue();
  const events = currentPack?.events ?? [];
  const count = events.length;

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Repair kit
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              {count} {count === 1 ? "fix" : "fixes"} ready
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              {isSignedIn
                ? "Review the fixes below, then publish them to your relays."
                : "Sign in to review and publish these fixes to your account."}
            </p>
          </div>

          {/* Fix list */}
          <div className="flex flex-col gap-2">
            {events.map((event, i) => (
              <EventCard key={i} event={event} />
            ))}
          </div>

          {/* Actions */}
          {!isSignedIn ? (
            <div className="flex flex-col gap-3">
              <button className="btn btn-primary w-full" onClick={handleSignIn}>
                Sign in to publish
              </button>
              <p className="text-xs text-base-content/40 text-center">
                You will be returned here after signing in.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-primary w-full"
                onClick={handlePublish}
                disabled={phase.name === "publishing"}
              >
                {phase.name === "publishing" ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Publishing…
                  </>
                ) : (
                  `Publish ${count} ${count === 1 ? "fix" : "fixes"}`
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReferralPage;
