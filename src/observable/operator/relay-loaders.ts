// ---------------------------------------------------------------------------
// Shared observable factories for relay-related loading patterns.
//
// These are used across multiple report loaders. Import from here rather than
// duplicating the logic in each loader.
//
// All functions return plain RxJS Observables — no React, no hooks.
// ---------------------------------------------------------------------------

import { getRelaysFromList } from "applesauce-common/helpers/lists";
import type { NostrEvent } from "applesauce-core/helpers";
import { of, type Observable } from "rxjs";
import { catchError, last, map, startWith } from "rxjs/operators";
import { pool } from "../../lib/relay.ts";
import { eventLoader } from "../../lib/store.ts";

/**
 * Fetches a relay list event by kind and extracts the relay URLs.
 * Uses eventLoader (completes after EOSE, never emits undefined).
 * Optional relay hints are passed to eventLoader to prefer specific relays.
 *
 * Returns:
 *   - `string[]` — relay URLs from the event (may be empty)
 *   - `null`     — event not found / timed out
 *
 * Emits once and completes.
 */
export function fetchRelayListUrls(
  kind: number,
  pubkey: string,
  hints: string[] = [],
): Observable<string[] | null> {
  return eventLoader({ kind, pubkey, relays: hints }).pipe(
    last(null, null as NostrEvent | null),
    map((event) => (event ? getRelaysFromList(event) : null)),
    catchError(() => of(null)),
  );
}

/**
 * Wraps `pool.relay(url).supported$` for use inside `combineLatest`.
 *
 * Emits `{ url, supported: null }` immediately (startWith), then
 * `{ url, supported: number[] | null }` after the NIP-11 HTTP fetch
 * completes. The inner observable completes after the fetch.
 *
 * `supported: null` means the fetch failed or the relay returned no
 * `supported_nips` field. The page treats this as "unknown".
 *
 * IMPORTANT: startWith is required here for combineLatest compatibility.
 * relay.supported$ has its own shareReplay(1) so subscribing multiple times
 * to the same relay URL does NOT trigger duplicate HTTP fetches.
 */
export function relayNip11Streaming(
  url: string,
): Observable<{ url: string; supported: number[] | null }> {
  return pool.relay(url).supported$.pipe(
    catchError(() => of(null as number[] | null)),
    map((supported) => ({ url, supported })),
    startWith({ url, supported: null as number[] | null }),
  );
}
