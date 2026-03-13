// ---------------------------------------------------------------------------
// Search Relay NIP-50 loader
//
// Fetches the subject's kind:10007 search relay list, then for each relay:
//   1. Checks NIP-11 information document for NIP-50 in supported_nips
//   2. Sends a live search REQ to confirm the relay actually responds to the
//      `search` filter field (some relays list NIP-50 but don't implement it,
//      and vice versa)
//
// Both checks stream incrementally: relay list arrives first (partial state
// with all null values), then results fill in as each fetch/probe completes.
//
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { kinds } from "applesauce-core/helpers";
import { of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  defaultIfEmpty,
  map,
  startWith,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs/operators";
import { pool } from "../../../lib/relay";
import { EVENT_LOAD_TIMEOUT_MS } from "../../../lib/timeouts";
import { loadAddressableEvent } from "../../../observable/loaders/load-addressable-event";
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByIndex } from "../../../observable/operator/combine-latest-by-index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of the live search REQ probe */
export type SearchProbeStatus =
  | null // probe still in progress
  | "supported" // relay returned EOSE or events in response to search filter
  | "unsupported" // relay returned CLOSED or error
  | "unknown"; // no response within timeout

export type SearchRelayNip50State = {
  /**
   * Relay URLs from kind:10007, or null if the event was not found / timed out.
   * An empty array means the event exists but lists no relays.
   */
  relayUrls: string[] | null;
  /**
   * Per-relay supported NIP numbers from NIP-11.
   * null  = NIP-11 fetch still in progress
   * array = resolved (check if includes 50)
   */
  nip11: Record<string, number[] | null>;
  /**
   * Per-relay result of a live search REQ probe.
   * null      = probe still in progress
   * "supported"   = relay responded to search filter
   * "unsupported" = relay rejected / closed the search filter
   * "unknown"     = no response within timeout
   */
  searchProbe: Record<string, SearchProbeStatus>;
};

// ---------------------------------------------------------------------------
// Live search probe
//
// Sends a REQ with `search` filter to the relay and waits for EOSE or an
// event. A relay that supports NIP-50 must accept the filter; one that
// doesn't typically closes the subscription or ignores the search field.
//
// We use relay.request() which completes on EOSE (single shot, no retry).
// ---------------------------------------------------------------------------

const SEARCH_PROBE_TIMEOUT_MS = 10_000;
const PROBE_SEARCH_TERM = "nostr"; // innocuous term unlikely to be blocked

function probeSearchSupport(url: string): Observable<SearchProbeStatus> {
  const relay = pool.relay(url);
  return relay
    .request({ kinds: [1], search: PROBE_SEARCH_TERM, limit: 1 })
    .pipe(
      // Map any returned event to "supported"
      map(() => "supported" as SearchProbeStatus),
      // relay.request() completes on EOSE — if no events came, default to
      // "supported" (the relay accepted the filter and responded with EOSE)
      defaultIfEmpty("supported" as SearchProbeStatus),
      // CLOSED or connection error → relay rejected the search filter
      catchError(() => of("unsupported" as SearchProbeStatus)),
      timeout({
        first: SEARCH_PROBE_TIMEOUT_MS,
        with: () => of("unknown" as SearchProbeStatus),
      }),
      catchError(() => of("unknown" as SearchProbeStatus)),
    );
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

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
      searchProbeByIndex: combineLatestByIndex(
        switchMap((url) =>
          probeSearchSupport(url).pipe(startWith(null as SearchProbeStatus)),
        ),
      ),
    }),
    map(({ relayUrls, nip11ByIndex, searchProbeByIndex }) => ({
      relayUrls,
      nip11: Object.fromEntries(
        relayUrls.map((url, index) => [url, nip11ByIndex[index] ?? null]),
      ),
      searchProbe: Object.fromEntries(
        relayUrls.map((url, index) => [url, searchProbeByIndex[index] ?? null]),
      ),
    })),
    catchError(() => of({ relayUrls: null, nip11: {}, searchProbe: {} })),
    shareReplay(1),
  );
}
