import { useEffect, useMemo, useState } from "react";
import { of, timeout } from "rxjs";
import { setContent } from "applesauce-core/operations";
import { use$ } from "applesauce-react/hooks";
import { useReport } from "../../context/ReportContext.tsx";
import { eventStore } from "../../lib/store.ts";
import { factory } from "../../lib/factory.ts";
import { AUTO_ADVANCE_MS, EVENT_LOAD_TIMEOUT_MS } from "../../lib/timeouts.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the embedded relay map from a kind:3 content field.
 * Old clients stored a relay config object here, e.g.:
 *   { "wss://relay.damus.io": { "read": true, "write": true }, ... }
 * Returns the relay URLs if present, or null if the content is empty/invalid.
 */
function parseEmbeddedRelays(content: string): string[] | null {
  if (!content || content.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const keys = Object.keys(parsed);
    return keys.length > 0 ? keys : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// EmbeddedRelayRow — a single relay URL from the embedded map
// ---------------------------------------------------------------------------

function EmbeddedRelayRow({ relayUrl }: { relayUrl: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-base-200 p-3">
      <div className="size-2 rounded-full bg-warning shrink-0" />
      <span className="font-mono text-sm text-base-content/80 break-all">
        {relayUrl}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function FollowListRelaysReport() {
  const { subject: subjectUser, next, publish: publishEvent } = useReport();

  // Subscribe to the user's kind:3 contacts event.
  // Pipes a timeout so the stream resolves to null (not found) rather than
  // staying undefined (loading) forever if kind:3 never arrives from relays.
  const contacts = use$(
    () =>
      subjectUser
        ? subjectUser.contacts$.pipe(
            timeout({ first: EVENT_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  // Get the raw event from the store to inspect the content field directly
  const rawEvent = subjectUser?.pubkey
    ? eventStore.getReplaceable(3, subjectUser.pubkey)
    : null;

  // Parse embedded relays out of the kind:3 content field
  const embeddedRelays = useMemo<string[] | null>(() => {
    if (!rawEvent) return null;
    return parseEmbeddedRelays(rawEvent.content);
  }, [rawEvent]);

  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // contacts is undefined while loading, null if timed-out/not-found, value when loaded
  const contactsLoaded = contacts !== undefined;
  const contactsNotFound = contacts === null;
  const isClean =
    contactsLoaded && !contactsNotFound && embeddedRelays === null;

  // Auto-advance when already clean (no embedded relays)
  useEffect(() => {
    if (isClean) {
      const timer = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [isClean, next]);

  // Auto-advance after successful publish
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [done, next]);

  async function handleRemove() {
    if (!subjectUser) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(3, subjectUser.pubkey);
      if (!existing) throw new Error("Could not find your follow list event.");
      const draft = await factory.modify(existing, setContent(""));
      await publishEvent(draft);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to publish follow list.",
      );
    } finally {
      setPublishing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state — contacts stream has not yet emitted
  // ---------------------------------------------------------------------------
  if (!contactsLoaded) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your follow list…
            </p>
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Not found — stream timed out, no kind:3 event found
  // ---------------------------------------------------------------------------
  if (contactsNotFound) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                Follow List Cleanup
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                No follow list found
              </h1>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
              No kind:3 follow list event could be found for this account. It
              may not exist yet, or relays were unreachable.
            </div>
            <button className="btn btn-outline btn-sm w-full" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // All-clear — no embedded relays in content (auto-advancing)
  // ---------------------------------------------------------------------------
  if (isClean) {
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
              <h2 className="text-lg font-semibold text-base-content">
                Follow list is clean
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                No embedded relay data found in your follow list.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Done — embedded relays removed and published (auto-advancing)
  // ---------------------------------------------------------------------------
  if (done) {
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
              <h2 className="text-lg font-semibold text-base-content">
                Follow list cleaned
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                Your updated follow list has been published.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main view — embedded relays found
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Follow List Cleanup
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              Embedded relay data
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              Your follow list has{" "}
              {embeddedRelays!.length === 1
                ? "1 relay"
                : `${embeddedRelays!.length} relays`}{" "}
              stored in its content field. This is leftover from older clients
              and is no longer used — NIP-65 (kind:10002) is the modern
              standard.
            </p>
          </div>

          {/* Embedded relay list */}
          <div className="flex flex-col gap-2">
            {embeddedRelays!.map((url) => (
              <EmbeddedRelayRow key={url} relayUrl={url} />
            ))}
          </div>

          {/* Info callout */}
          <div className="bg-base-200/60 rounded-xl p-3 text-xs text-base-content/60">
            Removing this data will not affect your follows. It only clears the
            unused relay map from the event content field.
          </div>

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              className="btn btn-primary w-full"
              onClick={handleRemove}
              disabled={publishing}
            >
              {publishing ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                "Remove Embedded Relays"
              )}
            </button>
            <button
              className="btn btn-ghost w-full"
              onClick={next}
              disabled={publishing}
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FollowListRelaysReport;
