// ---------------------------------------------------------------------------
// Legacy Lists — report section page
//
// Detects deprecated NIP-51 addressable list events and offers two actions
// per list:
//   - Merge: copy items into the modern replacement list, then delete legacy
//   - Delete: publish a kind:5 deletion event and trust relays to remove it
//
// Hidden (encrypted) tags: when a signer is available the user can unlock
// them, and the merge will include those items too. Without a signer the
// merge only covers public tags, with a visible warning.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { getListTags } from "applesauce-common/helpers/lists";
import {
  getHiddenTags,
  isHiddenTagsUnlocked,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import type { NostrEvent } from "applesauce-core/helpers";
import { eventStore } from "../../../lib/store.ts";
import { factory } from "../../../lib/factory.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { LegacyListEntry, LegacyListsState } from "./loader.ts";

// ---------------------------------------------------------------------------
// Constants — modern replacement kinds per NIP-51 deprecation table
// ---------------------------------------------------------------------------

const MODERN_KIND: Record<keyof LegacyListsState, number> = {
  mute: 10000,
  pin: 10001,
  bookmark: 10003,
  communities: 10004,
};

const LIST_LABELS: Record<keyof LegacyListsState, string> = {
  mute: "Mute list",
  pin: "Pinned notes",
  bookmark: "Bookmarks",
  communities: "Communities",
};

const LEGACY_KIND: Record<keyof LegacyListsState, number> = {
  mute: 30000,
  pin: 30001,
  bookmark: 30001,
  communities: 30001,
};

const LEGACY_D_TAG: Record<keyof LegacyListsState, string> = {
  mute: "mute",
  pin: "pin",
  bookmark: "bookmark",
  communities: "communities",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds the "a" tag coordinate string for an addressable event. */
function legacyCoordinate(key: keyof LegacyListsState, pubkey: string): string {
  return `${LEGACY_KIND[key]}:${pubkey}:${LEGACY_D_TAG[key]}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReadOnlyBanner() {
  return (
    <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
      You're viewing someone else's account. Actions will be queued as drafts —
      sign in as this account to publish them.
    </div>
  );
}

/**
 * A single row in the legacy list table. Manages its own
 * unlock / merge / delete state without adding any card border.
 */
function LegacyListRow({
  listKey,
  entry,
  pubkey,
  account,
  publish: publishEvent,
  onHandled,
  isLast,
}: {
  listKey: keyof LegacyListsState;
  entry: LegacyListEntry;
  pubkey: string;
  account: SectionProps["account"];
  publish: SectionProps["publish"];
  onHandled: () => void;
  isLast: boolean;
}) {
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReadOnly = account === null;
  const hasSigner = account !== null;
  const { event } = entry;

  // Re-check unlock state from the event itself (the helper mutates it in-place)
  const isUnlocked = event ? isHiddenTagsUnlocked(event) : false;
  const effectivelyUnlocked = unlocked || isUnlocked;

  const hiddenTagCount =
    effectivelyUnlocked && event
      ? (getHiddenTags(event)?.filter(([n]: string[]) => n !== "d").length ?? 0)
      : 0;

  const totalTagCount =
    entry.publicTagCount + (effectivelyUnlocked ? hiddenTagCount : 0);

  /** Collect all tags to migrate: public + (hidden if unlocked). */
  function collectMigrateTags(): string[][] {
    if (!event) return [];
    const pub = getListTags(event, "public").filter(
      ([n]: string[]) => n !== "d",
    );
    if (!effectivelyUnlocked) return pub;
    const hidden =
      getHiddenTags(event)?.filter(([n]: string[]) => n !== "d") ?? [];
    return [...pub, ...hidden];
  }

  async function handleUnlock() {
    if (!event || !account?.signer || unlocking) return;
    setUnlocking(true);
    setError(null);
    try {
      await unlockHiddenTags(event, account.signer);
      setUnlocked(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to decrypt hidden items.",
      );
    } finally {
      setUnlocking(false);
    }
  }

  async function handleMerge() {
    if (!event || merging) return;
    setMerging(true);
    setError(null);
    try {
      const tagsToMigrate = collectMigrateTags();
      const modernKind = MODERN_KIND[listKey];

      // Fetch the current modern list from the store (may be undefined if it
      // doesn't exist yet). We read only public tags from it to avoid
      // accidentally discarding existing hidden content.
      const modernEvent: NostrEvent | undefined = eventStore.getReplaceable(
        modernKind,
        pubkey,
      );

      const existingPublicTags = modernEvent
        ? getListTags(modernEvent, "public").filter(
            ([n]: string[]) => n !== "d",
          )
        : [];

      // Merge and deduplicate by serialised tag value
      const seen = new Set<string>(
        existingPublicTags.map((t) => JSON.stringify(t)),
      );
      const newTags: string[][] = [...existingPublicTags];
      for (const tag of tagsToMigrate) {
        const key = JSON.stringify(tag);
        if (!seen.has(key)) {
          seen.add(key);
          newTags.push(tag);
        }
      }

      // 1. Build and dispatch modern list update (fire-and-forget)
      const modernDraft = modernEvent
        ? await factory.modify(
            modernEvent,
            modifyPublicTags(() => newTags),
          )
        : await factory.build(
            { kind: modernKind },
            modifyPublicTags(() => newTags),
          );
      publishEvent(modernDraft);

      // 2. Build and dispatch kind:5 deletion event (fire-and-forget)
      const coord = legacyCoordinate(listKey, pubkey);
      const deleteDraft = await factory.build({
        kind: 5,
        tags: [["a", coord]],
      });
      publishEvent(deleteDraft);

      setDone(true);
      onHandled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to merge list.");
    } finally {
      setMerging(false);
    }
  }

  async function handleDeleteOnly() {
    if (!event || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      // Build and dispatch kind:5 deletion event (fire-and-forget)
      const coord = legacyCoordinate(listKey, pubkey);
      const deleteDraft = await factory.build({
        kind: 5,
        tags: [["a", coord]],
      });
      publishEvent(deleteDraft);

      setDone(true);
      onHandled();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to delete legacy list.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const legacyCoord = `kind:${LEGACY_KIND[listKey]} d="${LEGACY_D_TAG[listKey]}"`;
  const busy = merging || deleting || unlocking;
  const rowBorder = isLast ? "" : "border-b border-base-200";

  // Done state — inline success indicator, same row layout
  if (done) {
    return (
      <div className={`flex items-center gap-3 py-3 ${rowBorder}`}>
        <svg
          className="size-3.5 shrink-0 text-success"
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
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-success">
            {LIST_LABELS[listKey]}
          </span>
          <span className="text-xs text-base-content/40 font-mono ml-2">
            {legacyCoord}
          </span>
        </div>
        <span className="text-xs text-base-content/40 shrink-0">removed</span>
      </div>
    );
  }

  return (
    <div className={`py-3 flex flex-col gap-2 ${rowBorder}`}>
      {/* Row header — name + meta + item count */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{LIST_LABELS[listKey]}</span>
            <span className="badge badge-warning badge-xs">deprecated</span>
            {entry.hasHidden && (
              <span
                className={[
                  "badge badge-xs",
                  effectivelyUnlocked ? "badge-success" : "badge-ghost",
                ].join(" ")}
              >
                {effectivelyUnlocked
                  ? `${hiddenTagCount} hidden unlocked`
                  : "has hidden items"}
              </span>
            )}
          </div>
          <p className="text-xs text-base-content/40 font-mono mt-0.5">
            {legacyCoord}
          </p>
        </div>
        <span className="text-xs text-base-content/50 shrink-0 pt-0.5">
          {entry.publicTagCount} item{entry.publicTagCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Unlock row — only when locked hidden tags exist */}
      {entry.hasHidden && !effectivelyUnlocked && (
        <div className="flex items-center gap-2 pl-0">
          <button
            className="btn btn-ghost btn-outline"
            onClick={handleUnlock}
            disabled={!hasSigner || unlocking}
            title={!hasSigner ? "Sign in to unlock hidden items" : undefined}
          >
            {unlocking ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Unlock hidden items"
            )}
          </button>
          <span className="text-xs text-base-content/40">
            {hasSigner
              ? "Unlock to include hidden items in merge"
              : "Sign in to unlock hidden items"}
          </span>
        </div>
      )}

      {/* Error */}
      {error && <p className="text-xs text-error">{error}</p>}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          onClick={handleMerge}
          disabled={busy || totalTagCount === 0}
          title={totalTagCount === 0 ? "No items to merge" : undefined}
        >
          {merging ? (
            <span className="loading loading-spinner loading-xs" />
          ) : isReadOnly ? (
            `Queue merge → ${LIST_LABELS[listKey]}`
          ) : (
            `Merge → ${LIST_LABELS[listKey]}`
          )}
        </button>
        <button
          className="btn btn-ghost text-error"
          onClick={handleDeleteOnly}
          disabled={busy}
        >
          {deleting ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            "Delete only"
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportContent
// ---------------------------------------------------------------------------

export function ReportContent({
  subject,
  account,
  publish: publishEvent,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<LegacyListsState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  // Track which lists have been handled (merged or deleted)
  const [handledCount, setHandledCount] = useState(0);

  const isReadOnly = account === null;

  // Determine found lists once loading is complete
  const foundKeys = (
    ["mute", "pin", "bookmark", "communities"] as (keyof LegacyListsState)[]
  ).filter((k) => state?.[k]?.event !== null);

  const foundCount = foundKeys.length;
  const isClean = !isLoading && foundCount === 0;
  const allHandled = !isLoading && foundCount > 0 && handledCount >= foundCount;

  // Guard ref to fire onDone exactly once per outcome
  const doneFired = useRef(false);

  // Auto-advance when clean (no legacy lists found)
  useEffect(() => {
    if (isClean && !doneFired.current) {
      doneFired.current = true;
      const timer = setTimeout(() => {
        onDone({ status: "clean", summary: "No legacy NIP-51 lists found" });
      }, 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClean]);

  // Signal done when all found lists have been handled
  useEffect(() => {
    if (allHandled && !doneFired.current) {
      doneFired.current = true;
      onDone({
        status: "fixed",
        summary: `${foundCount} legacy list${foundCount !== 1 ? "s" : ""} removed`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allHandled]);

  function handleListHandled() {
    setHandledCount((n) => n + 1);
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            Checking for legacy NIP-51 lists…
          </p>
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-ghost btn-sm w-full"
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

  // ---------------------------------------------------------------------------
  // Clean state — no legacy lists found
  // ---------------------------------------------------------------------------

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
          <p className="text-sm font-medium">No legacy NIP-51 lists found</p>
        </div>
        <p className="text-xs text-base-content/40">
          None of the deprecated kind:30000/30001 list formats are present on
          this account.
        </p>
        {!isDoneSection && (
          <button className="btn btn-primary w-full" onClick={onContinue}>
            Continue
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // All-handled success state
  // ---------------------------------------------------------------------------

  if (allHandled) {
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
            {foundCount} legacy list{foundCount !== 1 ? "s" : ""}{" "}
            {isReadOnly ? "queued for removal" : "removed"}
          </p>
        </div>
        {!isDoneSection && (
          <button className="btn btn-primary w-full" onClick={onContinue}>
            Continue
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Report state — list of found legacy events
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-xs text-base-content/50">
        {foundCount} deprecated NIP-51 list{foundCount !== 1 ? "s" : ""} found.
        Merge items into the modern replacement, or delete the list entirely.
      </p>

      {isReadOnly && <ReadOnlyBanner />}

      {/* Flat list — dividers only, no card borders */}
      <div>
        {foundKeys.map((key, i) => (
          <LegacyListRow
            key={key}
            listKey={key}
            entry={state![key]}
            pubkey={subject.pubkey}
            account={account}
            publish={publishEvent}
            onHandled={handleListHandled}
            isLast={i === foundKeys.length - 1}
          />
        ))}
      </div>

      {!isDoneSection && (
        <button
          className="btn btn-ghost w-full"
          onClick={() => {
            if (!doneFired.current) {
              doneFired.current = true;
              onDone({
                status: "skipped",
                summary: `${foundCount} legacy list${foundCount !== 1 ? "s" : ""} left`,
              });
            }
            onContinue();
          }}
        >
          Skip
        </button>
      )}
    </div>
  );
}

export default ReportContent;
