import { useState } from "react";
import { useNavigate } from "react-router";
import type { NostrEvent } from "applesauce-core/helpers";
import { getEventUID } from "applesauce-core/helpers";
import { ExtensionMissingError } from "applesauce-signers/signers";
import { ExtensionAccount } from "applesauce-accounts/accounts";
import { manager } from "../../lib/accounts.ts";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { CompleteHeader, SuccessBadge } from "./_shared.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(kind: number): string {
  switch (kind) {
    case 0:
      return "Profile metadata";
    case 3:
      return "Follow list";
    case 5:
      return "Event deletion";
    case 10002:
      return "Relay list (NIP-65)";
    case 10006:
      return "Blocked relays";
    case 10007:
      return "Search relays";
    case 10012:
      return "Favorite relays";
    case 10050:
      return "DM relays";
    case 10051:
      return "Key package relays";
    default:
      return `Kind ${kind}`;
  }
}

function DraftEventRow({
  event,
  onRemove,
}: {
  event: NostrEvent;
  onRemove: () => void;
}) {
  const uid = getEventUID(event);
  const label = kindLabel(event.kind);
  const deletedIds =
    event.kind === 5
      ? event.tags.filter((t) => t[0] === "e").map((t) => t[1])
      : [];

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-base-200 last:border-0">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="badge badge-xs badge-ghost font-mono">
            kind:{event.kind}
          </span>
          <span className="text-sm text-base-content">{label}</span>
        </div>
        {deletedIds.length > 0 && (
          <p className="text-xs text-base-content/40 font-mono truncate">
            deletes {deletedIds[0].slice(0, 12)}…
            {deletedIds.length > 1 && ` +${deletedIds.length - 1} more`}
          </p>
        )}
        {event.kind !== 5 && (
          <p className="text-xs text-base-content/40 font-mono truncate">
            {uid.slice(0, 24)}…
          </p>
        )}
      </div>
      <button
        className="btn btn-ghost btn-xs text-base-content/40 hover:text-error hover:bg-error/10 shrink-0 mt-0.5"
        onClick={onRemove}
        aria-label={`Remove ${label} from queue`}
        title="Remove from queue"
      >
        <svg
          className="size-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineExtensionSignIn
//
// Tries to connect the browser extension and checks whether its pubkey matches
// the subject. If it matches, activates the account so CompleteView re-renders
// into SelfView and the user can publish immediately. If it doesn't match,
// shows a mismatch warning and falls back to the full sign-in flow.
// ---------------------------------------------------------------------------

function InlineExtensionSignIn({ subjectPubkey }: { subjectPubkey: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const account = await ExtensionAccount.fromExtension();
      if (account.pubkey === subjectPubkey) {
        // Pubkey matches — activate immediately, CompleteView will re-render
        manager.addAccount(account);
        manager.setActive(account);
      } else {
        // Pubkey mismatch — don't activate, explain and offer full sign-in
        setError(
          `This extension is signed in as a different account. Use the full sign-in page to log in as the correct account, or continue without signing in.`,
        );
      }
    } catch (err) {
      if (err instanceof ExtensionMissingError) {
        setError(
          "No Nostr browser extension found. Install Alby or nos2x and try again.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Extension connection failed.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        className="btn btn-primary w-full"
        onClick={handleConnect}
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Connecting…
          </>
        ) : (
          <>
            <svg
              className="size-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Sign in with browser extension
          </>
        )}
      </button>
      {error && <p className="text-xs text-error">{error}</p>}
      <button
        className="btn btn-ghost btn-sm w-full text-base-content/50"
        onClick={() =>
          navigate(`/signin?redirect=${encodeURIComponent("/complete")}`)
        }
      >
        More sign-in options
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyView — no signer present
// ---------------------------------------------------------------------------

function ReadOnlyView({
  draftEvents,
  hasSkippedIssues,
  onStartOver,
  subjectPubkey,
}: {
  draftEvents: NostrEvent[];
  hasSkippedIssues: boolean;
  onStartOver: () => void;
  subjectPubkey: string;
}) {
  const hasDrafts = draftEvents.length > 0;

  function handleRemove(event: NostrEvent) {
    const uid = getEventUID(event);
    const current = draftEvents$.getValue();
    const next = { ...current };
    delete next[uid];
    draftEvents$.next(next);
  }

  if (!hasDrafts && !hasSkippedIssues) {
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

  if (!hasDrafts && hasSkippedIssues) {
    return (
      <>
        <CompleteHeader subtitle="Your diagnostic is complete." />
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5 flex flex-col gap-2">
          <p className="text-sm font-medium text-base-content">
            Suggested changes were skipped
          </p>
          <p className="text-sm text-base-content/60">
            Some issues were found during the diagnostic but no fixes were
            selected. Go back to review and apply the suggested changes.
          </p>
          <button
            className="btn btn-warning btn-sm mt-1 self-start"
            onClick={() => window.history.back()}
          >
            Go back
          </button>
        </div>
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
        subtitle={`Diagnostic complete. ${fixes} — sign in to publish.`}
      />

      <div className="bg-base-200 rounded-xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-base-content">
            Review pending fixes
          </p>
          <p className="text-xs text-base-content/50 mt-0.5">
            Sign in with the account you diagnosed to publish these changes
            directly.
          </p>
        </div>

        {/* Draft list */}
        <div className="bg-base-100 rounded-lg px-3 py-1 flex flex-col">
          {draftEvents.map((event) => (
            <DraftEventRow
              key={getEventUID(event)}
              event={event}
              onRemove={() => handleRemove(event)}
            />
          ))}
        </div>

        {/* Inline extension sign-in */}
        <InlineExtensionSignIn subjectPubkey={subjectPubkey} />
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
