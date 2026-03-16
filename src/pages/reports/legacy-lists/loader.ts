// ---------------------------------------------------------------------------
// Legacy Lists loader
//
// Checks for deprecated NIP-51 addressable list events that older clients
// created, per the deprecation table in NIP-51:
//
//   kind:30000  d="mute"        → replaced by kind:10000 (mute list)
//   kind:30001  d="pin"         → replaced by kind:10001 (pinned notes)
//   kind:30001  d="bookmark"    → replaced by kind:10003 (bookmarks)
//   kind:30001  d="communities" → replaced by kind:10004 (communities)
//
// Pattern: combineLatest of 4 independent loadAddressableEvent calls, each
// with startWith(null) so the state streams immediately as any one resolves.
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getListTags } from "applesauce-common/helpers/lists";
import type { NostrEvent } from "applesauce-core/helpers";
import { hasHiddenTags } from "applesauce-core/helpers";
import { combineLatest, of, shareReplay, type Observable } from "rxjs";
import { catchError, map, startWith } from "rxjs/operators";
import { loadAddressableEvent } from "../../../observable/loaders/load-addressable-event.ts";

// ---------------------------------------------------------------------------
// Constants — deprecated kind + d-tag pairs per NIP-51
// ---------------------------------------------------------------------------

export const LEGACY_MUTE_KIND = 30000;
export const LEGACY_LIST_KIND = 30001;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/** Per-legacy-list state. null event means not found (or timed out). */
export type LegacyListEntry = {
  /** The deprecated addressable event, or null if not found. */
  event: NostrEvent | null;
  /** Number of public tags (items that could be migrated). */
  publicTagCount: number;
  /** True if the event has an encrypted content field (hidden tags present). */
  hasHidden: boolean;
};

export type LegacyListsState = {
  /** kind:30000 d="mute" → modern kind:10000 */
  mute: LegacyListEntry;
  /** kind:30001 d="pin" → modern kind:10001 */
  pin: LegacyListEntry;
  /** kind:30001 d="bookmark" → modern kind:10003 */
  bookmark: LegacyListEntry;
  /** kind:30001 d="communities" → modern kind:10004 */
  communities: LegacyListEntry;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts a raw NostrEvent (or null from startWith) into a LegacyListEntry. */
function toEntry(event: NostrEvent | null): LegacyListEntry {
  if (!event) return { event: null, publicTagCount: 0, hasHidden: false };
  return {
    event,
    // Count only the public (non-content) tags, excluding the "d" identifier tag
    publicTagCount: getListTags(event, "public").filter(
      ([name]) => name !== "d",
    ).length,
    // Check if event.content is non-empty (encrypted private items present)
    hasHidden: hasHiddenTags(event),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<LegacyListsState> {
  // Each fetch completes after EOSE from the user's outbox + default relays.
  // startWith(null) ensures combineLatest emits immediately before any resolves.
  const mute$ = loadAddressableEvent(user, LEGACY_MUTE_KIND, "mute").pipe(
    startWith(null as NostrEvent | null),
    catchError(() => of(null as NostrEvent | null)),
  );

  const pin$ = loadAddressableEvent(user, LEGACY_LIST_KIND, "pin").pipe(
    startWith(null as NostrEvent | null),
    catchError(() => of(null as NostrEvent | null)),
  );

  const bookmark$ = loadAddressableEvent(
    user,
    LEGACY_LIST_KIND,
    "bookmark",
  ).pipe(
    startWith(null as NostrEvent | null),
    catchError(() => of(null as NostrEvent | null)),
  );

  const communities$ = loadAddressableEvent(
    user,
    LEGACY_LIST_KIND,
    "communities",
  ).pipe(
    startWith(null as NostrEvent | null),
    catchError(() => of(null as NostrEvent | null)),
  );

  return combineLatest({
    mute: mute$,
    pin: pin$,
    bookmark: bookmark$,
    communities: communities$,
  }).pipe(
    map(({ mute, pin, bookmark, communities }) => ({
      mute: toEntry(mute),
      pin: toEntry(pin),
      bookmark: toEntry(bookmark),
      communities: toEntry(communities),
    })),
    catchError(() =>
      // On any unexpected error, emit an all-clear state so the page can advance
      of({
        mute: toEntry(null),
        pin: toEntry(null),
        bookmark: toEntry(null),
        communities: toEntry(null),
      }),
    ),
    shareReplay(1), // prevent re-execution when multiple subscribers attach
  );
}
