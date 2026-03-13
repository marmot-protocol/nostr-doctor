// ---------------------------------------------------------------------------
// Profile Metadata loader
//
// Fetches the subject's kind:0 event and derives non-standard fields from its
// content JSON.
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
// Standard kind:0 fields per NIP-01, NIP-24, NIP-05, NIP-57
// ---------------------------------------------------------------------------

const STANDARD_FIELDS = new Set([
  "name",
  "about",
  "picture",
  "display_name",
  "website",
  "banner",
  "bot",
  "birthday",
  "nip05",
  "lud06",
  "lud16",
  "languages",
]);

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

export type ProfileMetadataState = {
  /** The raw kind:0 event, or null if not found / timed out. */
  event: NostrEvent | null;
  /** Non-standard fields found in the event's content JSON. */
  nonStandardFields: [string, unknown][];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveNonStandardFields(
  event: NostrEvent | null,
): [string, unknown][] {
  if (!event) return [];
  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;
    return Object.entries(content).filter(([k]) => !STANDARD_FIELDS.has(k));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<ProfileMetadataState> {
  // eventStore.replaceable() emits immediately (undefined on cache-miss, then
  // the event when it arrives from the network via the store's eventLoader).
  // This ensures toLoaderState() always receives at least one emission before
  // the page's takeUntil deadline fires, so the loader never hangs.
  return eventStore.replaceable(0, user.pubkey).pipe(
    // Complete as soon as the event arrives (inclusive). Without this the
    // observable never completes on its own and toLoaderState() would stay
    // at complete:false until the page's takeUntil(timer(10s)) fires.
    takeWhile((event) => event === undefined, true),
    map((event: NostrEvent | undefined) => ({
      event: event ?? null,
      nonStandardFields: deriveNonStandardFields(event ?? null),
    })),
    catchError(() =>
      of({ event: null, nonStandardFields: [] as [string, unknown][] }),
    ),
    shareReplay(1),
  );
}
