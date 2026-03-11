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
import { catchError, last, map } from "rxjs/operators";
import { eventLoader } from "../../../lib/store.ts";

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
  return eventLoader({ kind: 3, pubkey: user.pubkey }).pipe(
    last(null, null as NostrEvent | null), // take the last event before EOSE, or null
    map((event) => ({
      event,
      embeddedRelays: event ? parseEmbeddedRelays(event.content) : null, // extract relay URLs from content JSON
    })),
    catchError(() => of({ event: null, embeddedRelays: null })), // map errors to null state
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
