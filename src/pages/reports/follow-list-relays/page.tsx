import { useEffect, useState } from "react";
import { setContent } from "applesauce-core/operations";
import { use$ } from "applesauce-react/hooks";
import { timer } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { toLoaderState } from "../../../observable/operator/to-loader-state.ts";
import { useReport } from "../../../context/ReportContext.tsx";
import { eventStore } from "../../../lib/store.ts";
import { factory } from "../../../lib/factory.ts";
import {
  AUTO_ADVANCE_MS,
  EVENT_LOAD_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";
import { createLoader } from "./loader.ts";

// ---------------------------------------------------------------------------
// EmbeddedRelayRow — single relay URL from the embedded map
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
  const { subject, next, publish: publishEvent } = useReport();

  // -------------------------------------------------------------------------
  // Loader
  // -------------------------------------------------------------------------
  const loaderState = use$(
    () =>
      subject
        ? createLoader(subject).pipe(
            takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
            toLoaderState(),
          )
        : undefined,
    [subject?.pubkey],
  );

  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  // -------------------------------------------------------------------------
  // Page-local UI state
  // -------------------------------------------------------------------------
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClean =
    !isLoading && state?.event !== null && state?.embeddedRelays === null;

  // Auto-advance when already clean
  useEffect(() => {
    if (isClean) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [isClean, next]);

  // Auto-advance after successful publish
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [done, next]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  async function handleRemove() {
    if (!subject) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(3, subject.pubkey);
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

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your follow list…
            </p>
            {state?.event !== undefined &&
              state.embeddedRelays !== undefined && (
                <p className="text-xs text-base-content/40">
                  Event found, analysing…
                </p>
              )}
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not found
  // -------------------------------------------------------------------------
  if (state?.event === null) {
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

  // -------------------------------------------------------------------------
  // All-clear (auto-advancing)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Done (auto-advancing)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Report — embedded relays found
  // -------------------------------------------------------------------------
  const embeddedRelays = state?.embeddedRelays ?? [];

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Follow List Cleanup
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              Embedded relay data
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              Your follow list has{" "}
              {embeddedRelays.length === 1
                ? "1 relay"
                : `${embeddedRelays.length} relays`}{" "}
              stored in its content field. This is leftover from older clients
              and is no longer used — NIP-65 (kind:10002) is the modern
              standard.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {embeddedRelays.map((url) => (
              <EmbeddedRelayRow key={url} relayUrl={url} />
            ))}
          </div>

          <div className="bg-base-200/60 rounded-xl p-3 text-xs text-base-content/60">
            Removing this data will not affect your follows. It only clears the
            unused relay map from the event content field.
          </div>

          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

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
