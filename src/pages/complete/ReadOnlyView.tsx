import { useNavigate } from "react-router";
import type { NostrEvent } from "applesauce-core/helpers";
import { getEventUID } from "applesauce-core/helpers";
import { draftEvents$ } from "../../lib/draftEvents.ts";
import { CompleteHeader, SuccessBadge } from "./_shared.tsx";

// ---------------------------------------------------------------------------
// Helpers (duplicated from SelfView to avoid a shared module dependency)
// ---------------------------------------------------------------------------

function kindLabel(kind: number): string {
  switch (kind) {
    case 0: return "Profile metadata";
    case 3: return "Follow list";
    case 5: return "Event deletion";
    case 10002: return "Relay list (NIP-65)";
    case 10006: return "Blocked relays";
    case 10007: return "Search relays";
    case 10012: return "Favorite relays";
    case 10050: return "DM relays";
    case 10051: return "Key package relays";
    default: return `Kind ${kind}`;
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
  const deletedIds = event.kind === 5
    ? event.tags.filter((t) => t[0] === "e").map((t) => t[1])
    : [];

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-base-200 last:border-0">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="badge badge-xs badge-ghost font-mono">kind:{event.kind}</span>
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
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

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
  hasSkippedIssues,
  onStartOver,
}: {
  draftEvents: NostrEvent[];
  hasSkippedIssues: boolean;
  onStartOver: () => void;
}) {
  const navigate = useNavigate();
  const hasDrafts = draftEvents.length > 0;

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

  function handleRemove(event: NostrEvent) {
    const uid = getEventUID(event);
    const current = draftEvents$.getValue();
    const next = { ...current };
    delete next[uid];
    draftEvents$.next(next);
  }

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
