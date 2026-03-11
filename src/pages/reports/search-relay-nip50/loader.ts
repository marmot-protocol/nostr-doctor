// ---------------------------------------------------------------------------
// Search Relay NIP-50 loader
//
// Fetches the subject's kind:10007 search relay list, then checks each relay's
// NIP-11 information document to determine NIP-50 search support.
//
// Data classification:
//   - kind:10007 event → PRIMARY OUTPUT — use fetchRelayListUrls (eventLoader)
//   - Per-relay NIP-11 supported NIPs → PRIMARY OUTPUT — use relayNip11Streaming
//
// Pattern C→B: fetchRelayListUrls → switchMap → combineLatest of
//              relayNip11Streaming per URL
//
// State streams incrementally: relay list arrives first (partial state with
// nip11 all null), then NIP-11 docs fill in as each HTTP fetch completes.
//
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { kinds } from "applesauce-core/helpers";
import { of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  map,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import { pool } from "../../../lib/relay";
import { EVENT_LOAD_TIMEOUT_MS } from "../../../lib/timeouts";
import { loadAddressableEvent } from "../../../observable/loaders/load-addressable-event";
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByIndex } from "../../../observable/operator/combine-latest-by-index.ts";

export type SearchRelayNip50State = {
  /**
   * Relay URLs from kind:10007, or null if the event was not found / timed out.
   * An empty array means the event exists but lists no relays.
   */
  relayUrls: string[] | null;
  /**
   * Per-relay supported NIP numbers from NIP-11.
   * null value = NIP-11 fetch still in progress for that relay.
   * Missing key = relay not yet seen (shouldn't happen after Phase 1).
   * Empty array or absent NIP 50 = relay doesn't support NIP-50.
   */
  nip11: Record<string, number[] | null>;
};

export function createLoader(user: User): Observable<SearchRelayNip50State> {
  return loadAddressableEvent(user, kinds.SearchRelaysList).pipe(
    map((event) => getRelaysFromList(event)),
    combineLatestBy({
      relayUrls: map((relayUrls) => relayUrls),
      nip11ByIndex: combineLatestByIndex(
        switchMap((url) =>
          pool.relay(url).supported$.pipe(
            catchError(() => of(null)),
            takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
            startWith(null),
          ),
        ),
      ),
    }),
    map(({ relayUrls, nip11ByIndex }) => ({
      relayUrls,
      nip11: Object.fromEntries(
        relayUrls.map((url, index) => [url, nip11ByIndex[index] ?? null]),
      ),
    })),
    catchError(() => of({ relayUrls: null, nip11: {} })),
    shareReplay(1),
  );
}
