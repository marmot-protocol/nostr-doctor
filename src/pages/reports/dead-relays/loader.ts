// ---------------------------------------------------------------------------
// Dead Relays loader
//
// Checks all relay list types for dead (offline) relays:
//   - NIP-65 relays  (kind:10002) — combined read/write/both per URL
//   - Favorite relays       (kind:10012)
//   - Search relays         (kind:10007)
//   - DM relays             (kind:10050)
//   - Blocked relays        (kind:10006)
//
// Pattern C: independent sub-loaders composed via combineLatest.
//   Each sub-loader: loadAddressableEvent → map URLs → switchMap →
//                    merge(relayVerdict per url) → scan into verdicts record
//
// State streams incrementally as each sub-loader resolves. Each sub-loader
// is independently subscribable for debugging — if the combined loader hangs,
// subscribe to each sub-loader individually to isolate which list is stuck.
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import type { NostrEvent } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers";
import {
  combineLatest,
  merge,
  of,
  shareReplay,
  timer,
  type Observable,
  type OperatorFunction,
} from "rxjs";
import {
  catchError,
  map,
  scan,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import {
  relayVerdict,
  type RelayVerdict,
} from "../../../lib/relay-monitors.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts";
import { loadAddressableEvent } from "../../../observable/loaders/load-addressable-event";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type RelayMarker = "read" | "write" | "both";

/** State for a single relay list: the URLs and the per-URL online verdict. */
export type RelayListState = {
  /** Relay URLs from this list event. null = event not found / still loading. */
  urls: string[] | null;
  /**
   * Per-relay verdict. null = verdict still in progress.
   * Empty object while urls is null or empty.
   */
  verdicts: Record<string, RelayVerdict | null>;
};

/** State for the NIP-65 relay list: combined read/write/both markers + verdicts. */
export type Nip65RelayListState = {
  /** All unique relay URLs from the kind:10002 event. null = not yet loaded. */
  urls: string[] | null;
  /** Per-relay read/write/both marker derived from the `r` tag. */
  markers: Record<string, RelayMarker>;
  /** Per-relay online verdict. null = verdict still in progress. */
  verdicts: Record<string, RelayVerdict | null>;
};

/** Combined state across all relay list types. */
export type DeadRelaysState = {
  nip65: Nip65RelayListState;
  favoriteRelays: RelayListState;
  searchRelays: RelayListState;
  dmRelays: RelayListState;
  blockedRelays: RelayListState;
};

const EMPTY_LIST: RelayListState = { urls: null, verdicts: {} };
const EMPTY_NIP65: Nip65RelayListState = {
  urls: null,
  markers: {},
  verdicts: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses a kind:10002 event's `r` tags and returns a map of
 * url → "read" | "write" | "both".
 * A relay with no marker is both read and write.
 */
function parseNip65Markers(
  event: NostrEvent | null,
): Record<string, RelayMarker> {
  if (!event) return {};
  const markers: Record<string, RelayMarker> = {};
  for (const tag of event.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const url = tag[1];
    const mode = tag[2] as string | undefined;
    const existing = markers[url];
    if (mode === "read") {
      markers[url] = existing === "write" ? "both" : "read";
    } else if (mode === "write") {
      markers[url] = existing === "read" ? "both" : "write";
    } else {
      // no marker = both
      markers[url] = "both";
    }
  }
  return markers;
}

// ---------------------------------------------------------------------------
// Shared helper operator
// ---------------------------------------------------------------------------

/**
 * Takes a string[] source and produces { urls, verdicts } where each relay's
 * verdict updates independently as it arrives — no synchronization barrier.
 *
 * Uses mergeMap so every relay's verdict stream runs in parallel. Each
 * emission is a {url, verdict} patch that scan folds into the growing record.
 * This means relay rows light up one-by-one as each monitor reports back,
 * rather than all flipping simultaneously when the last relay resolves.
 */
function relayListStatus(): OperatorFunction<string[], RelayListState> {
  return (source) =>
    source.pipe(
      switchMap((urls) => {
        // Seed: emit the full URL list with all verdicts null immediately
        const seed: RelayListState = {
          urls,
          verdicts: Object.fromEntries(urls.map((url) => [url, null])),
        };
        if (urls.length === 0) return of(seed);

        // One patch stream per relay — each completes independently
        const patches$ = merge(
          ...urls.map((url) =>
            relayVerdict(url).pipe(
              catchError(() => of("unknown" as RelayVerdict)),
              map((verdict) => ({ url, verdict })),
            ),
          ),
        );

        return patches$.pipe(
          // Fold each patch into the accumulated state
          scan(
            (state, { url, verdict }) => ({
              ...state,
              verdicts: { ...state.verdicts, [url]: verdict },
            }),
            seed,
          ),
          // Start with the seed so the page can render all rows immediately
          startWith(seed),
        );
      }),
    );
}

// ---------------------------------------------------------------------------
// Per-list sub-loaders
// ---------------------------------------------------------------------------

/** NIP-65 combined loader — merges read and write relays into one list with markers. */
export function createNip65Loader(user: User): Observable<Nip65RelayListState> {
  return loadAddressableEvent(user, kinds.RelayList).pipe(
    // Fan out verdict per unique URL while preserving markers
    switchMap((event) => {
      const markerMap = parseNip65Markers(event);
      const urls = Object.keys(markerMap);
      if (urls.length === 0) {
        return of({
          urls,
          markers: markerMap,
          verdicts: {} as Record<string, RelayVerdict | null>,
        });
      }
      // Build a RelayListState stream for the URL set, then re-attach markers
      return of(urls).pipe(
        relayListStatus(),
        map(({ urls: u, verdicts }) => ({
          urls: u,
          markers: markerMap,
          verdicts,
        })),
      );
    }),
    catchError(() => of(EMPTY_NIP65)),
  );
}

export function createFavoriteRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.FavoriteRelays).pipe(
    map((event) => getRelaysFromList(event)),
    relayListStatus(),
  );
}

export function createSearchRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.SearchRelaysList).pipe(
    map((event) => getRelaysFromList(event)),
    relayListStatus(),
  );
}

export function createDmRelaysLoader(user: User): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.DirectMessageRelaysList).pipe(
    map((event) => getRelaysFromList(event)),
    relayListStatus(),
  );
}

export function createBlockedRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.BlockedRelaysList).pipe(
    map((event) => getRelaysFromList(event)),
    relayListStatus(),
  );
}

// ---------------------------------------------------------------------------
// Composed loader
// ---------------------------------------------------------------------------

function streaming(
  loader: Observable<RelayListState>,
): Observable<RelayListState> {
  return loader.pipe(
    startWith(EMPTY_LIST),
    catchError(() => of(EMPTY_LIST)),
  );
}

function streamingNip65(
  loader: Observable<Nip65RelayListState>,
): Observable<Nip65RelayListState> {
  return loader.pipe(
    startWith(EMPTY_NIP65),
    catchError(() => of(EMPTY_NIP65)),
  );
}

export default function deadRelaysLoader(
  user: User,
): Observable<DeadRelaysState> {
  return combineLatest({
    nip65: streamingNip65(createNip65Loader(user)),
    favoriteRelays: streaming(createFavoriteRelaysLoader(user)),
    searchRelays: streaming(createSearchRelaysLoader(user)),
    dmRelays: streaming(createDmRelaysLoader(user)),
    blockedRelays: streaming(createBlockedRelaysLoader(user)),
  }).pipe(takeUntil(timer(LOADER_TIMEOUT_MS)), shareReplay(1));
}
