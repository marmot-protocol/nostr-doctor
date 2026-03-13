import { useEffect, useState } from "react";
import { setContent } from "applesauce-core/operations";
import { eventStore } from "../../../lib/store.ts";
import { factory } from "../../../lib/factory.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { FollowListRelaysState } from "./loader.ts";

// ---------------------------------------------------------------------------
// EmbeddedRelayRow
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
// ReportContent
// ---------------------------------------------------------------------------

function ReadOnlyBanner() {
  return (
    <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
      You're viewing someone else's account. This fix will be queued as a draft
      and needs signing at the end.
    </div>
  );
}

export function ReportContent({
  subject,
  account,
  publish: publishEvent,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<FollowListRelaysState>) {
  const isReadOnly = account === null;
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const isClean =
    !isLoading && state?.event !== null && state?.embeddedRelays === null;

  useEffect(() => {
    if (isClean && !advanced) {
      setAdvanced(true);
      onDone({ status: "clean", summary: "No embedded relay data" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClean]);

  useEffect(() => {
    if (done) {
      const embeddedRelays = state?.embeddedRelays ?? [];
      onDone({
        status: "fixed",
        summary: `${embeddedRelays.length} embedded relay${embeddedRelays.length !== 1 ? "s" : ""} removed`,
        detail: embeddedRelays,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

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

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            Loading your follow list…
          </p>
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDone({ status: "skipped", summary: "Skipped" });
              onContinue();
            }}
          >
            Skip
          </button>
        )}
      </div>
    );
  }

  if (state?.event === null) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
          No kind:3 follow list event found for this account.
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({ status: "notfound", summary: "No follow list found" });
              onContinue();
            }}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  // All-clear
  if (isClean) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-2 text-success">
          <svg
            className="size-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-sm font-medium">
            No embedded relay data — follow list is clean
          </p>
        </div>
        <p className="text-xs text-base-content/40">
          Older clients stored relay hints in the kind:3 content field. NIP-65
          (kind:10002) is the modern standard. Your follow list content field is
          clean.
        </p>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={onContinue}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  // Done
  if (done) {
    const embeddedRelays = state?.embeddedRelays ?? [];
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-2 text-success">
          <svg
            className="size-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-sm font-medium">
            Follow list cleaned — {embeddedRelays.length} embedded relay
            {embeddedRelays.length !== 1 ? "s" : ""} removed
          </p>
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={onContinue}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  const embeddedRelays = state?.embeddedRelays ?? [];

  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-sm text-base-content/70">
        Your follow list has{" "}
        {embeddedRelays.length === 1
          ? "1 relay"
          : `${embeddedRelays.length} relays`}{" "}
        stored in its content field. This is leftover from older clients —
        NIP-65 (kind:10002) is the modern standard.
      </p>
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
      {isReadOnly && <ReadOnlyBanner />}
      <div className="flex flex-col gap-2">
        <button
          className="btn btn-primary w-full"
          onClick={handleRemove}
          disabled={publishing}
        >
          {publishing ? (
            <span className="loading loading-spinner loading-xs" />
          ) : isReadOnly ? (
            "Queue removal"
          ) : (
            "Remove Embedded Relays"
          )}
        </button>
        {!isDoneSection && (
          <button
            className="btn btn-ghost btn-sm w-full"
            onClick={() => {
              onDone({
                status: "skipped",
                summary: `${embeddedRelays.length} embedded relay${embeddedRelays.length !== 1 ? "s" : ""} left`,
              });
              onContinue();
            }}
            disabled={publishing}
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

export default ReportContent;
