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
import { catchError, last, map } from "rxjs/operators";
import { eventLoader } from "../../../lib/store.ts";

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
  return eventLoader({ kind: 0, pubkey: user.pubkey }).pipe(
    last(null, null as NostrEvent | null), // take the last event before EOSE, or null
    map((event) => ({
      event,
      nonStandardFields: deriveNonStandardFields(event), // derive non-standard fields from content
    })),
    catchError(() =>
      of({ event: null, nonStandardFields: [] as [string, unknown][] }),
    ), // map errors to null state
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
