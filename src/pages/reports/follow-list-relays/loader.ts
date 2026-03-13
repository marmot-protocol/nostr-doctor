// ---------------------------------------------------------------------------
// Follow List Relays loader
//
// Fetches the subject's kind:3 contacts event and derives any embedded relay
// map from its content field. Old clients stored a relay config object in the
// content JSON (e.g. { "wss://relay.damus.io": { read: true, write: true } }).
// This is no longer used — NIP-65 (kind:10002) is the modern standard.
//
// Pattern A: single source → last() → map → catchError → shareReplay(1)
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import type { NostrEvent } from "applesauce-core/helpers";
import { of, shareReplay, type Observable } from "rxjs";
import { catchError, map, takeWhile } from "rxjs/operators";
import { eventStore } from "../../../lib/store.ts";

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

export type FollowListRelaysState = {
  /** The raw kind:3 event, or null if not found / timed out. */
  event: NostrEvent | null;
  /**
   * Relay URLs found in the kind:3 content JSON, or null if content is
   * empty / not a relay map / event not found.
   */
  embeddedRelays: string[] | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<FollowListRelaysState> {
  // eventStore.replaceable() emits immediately (undefined on cache-miss, then
  // the event when it arrives from the network via the store's eventLoader).
  // This ensures toLoaderState() always receives at least one emission before
  // the page's takeUntil deadline fires, so the loader never hangs.
  return eventStore.replaceable(3, user.pubkey).pipe(
    // Complete as soon as the event arrives (inclusive) so toLoaderState()
    // marks the section done without waiting for the 10 s page timeout.
    takeWhile((event) => event === undefined, true),
    map((event: NostrEvent | undefined) => ({
      event: event ?? null,
      embeddedRelays: event ? parseEmbeddedRelays(event.content) : null,
    })),
    catchError(() => of({ event: null, embeddedRelays: null })),
    shareReplay(1),
  );
}
