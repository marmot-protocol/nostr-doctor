// ---------------------------------------------------------------------------
// Dead Relays loader
//
// Checks all six relay list types for dead (offline) relays:
//   - NIP-65 outbox relays  (kind:10002 write)
//   - NIP-65 inbox relays   (kind:10002 read)
//   - Favorite relays       (kind:10012)
//   - Search relays         (kind:10007)
//   - DM relays             (kind:10050)
//   - Blocked relays        (kind:10006)
//
// Pattern C: six independent sub-loaders composed via combineLatest.
//   Each sub-loader: loadAddressableEvent → map URLs → combineLatestBy →
//                    urls passthrough + combineLatestByIndex of relayVerdict
//
// State streams incrementally as each sub-loader resolves. Each sub-loader
// is independently subscribable for debugging — if the combined loader hangs,
// subscribe to each sub-loader individually to isolate which list is stuck.
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { kinds } from "applesauce-core/helpers";
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
import {
  combineLatest,
  of,
  shareReplay,
  timer,
  type Observable,
  type OperatorFunction,
} from "rxjs";
import {
  catchError,
  map,
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
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByIndex } from "../../../observable/operator/combine-latest-by-index.ts";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

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

/** Combined state across all six relay list types. */
export type DeadRelaysState = {
  outboxes: RelayListState;
  inboxes: RelayListState;
  favoriteRelays: RelayListState;
  searchRelays: RelayListState;
  dmRelays: RelayListState;
  blockedRelays: RelayListState;
};

const EMPTY_LIST: RelayListState = { urls: null, verdicts: {} };

// ---------------------------------------------------------------------------
// Shared helper operator
// ---------------------------------------------------------------------------

/** Takes a string[] source and produces { urls, verdicts } streaming per-relay verdicts. */
function relayListStatus(): OperatorFunction<string[], RelayListState> {
  return (source) =>
    source.pipe(
      combineLatestBy({
        urls: map((urls) => urls), // pass relay URLs through unchanged
        verdicts: combineLatestByIndex(
          // fan out verdict per URL in parallel
          switchMap((url) =>
            relayVerdict(url).pipe(
              catchError(() => of("unknown" as RelayVerdict)), // map verdict errors to unknown
              startWith(null as RelayVerdict | null), // null = verdict still loading
            ),
          ),
        ),
      }),
      map(({ urls, verdicts }) => ({
        urls,
        verdicts: Object.fromEntries(
          // reshape indexed verdicts to a url-keyed record
          urls.map((url, index) => [url, verdicts[index] ?? null]),
        ),
      })),
    );
}

// ---------------------------------------------------------------------------
// Per-list sub-loaders
//
// Each is independently subscribable for debugging.
// ---------------------------------------------------------------------------

export function createOutboxesLoader(user: User): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.RelayList).pipe(
    map((event) => getOutboxes(event)), // extract outbox URLs from relay list
    relayListStatus(), // fan out verdict per URL
  );
}

export function createInboxesLoader(user: User): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.RelayList).pipe(
    map((event) => getInboxes(event)), // extract inbox URLs from relay list
    relayListStatus(), // fan out verdict per URL
  );
}

export function createFavoriteRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.FavoriteRelays).pipe(
    map((event) => getRelaysFromList(event)), // extract favorite relay URLs
    relayListStatus(), // fan out verdict per URL
  );
}

export function createSearchRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.SearchRelaysList).pipe(
    map((event) => getRelaysFromList(event)), // extract search relay URLs
    relayListStatus(), // fan out verdict per URL
  );
}

export function createDmRelaysLoader(user: User): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.DirectMessageRelaysList).pipe(
    map((event) => getRelaysFromList(event)), // extract DM relay URLs
    relayListStatus(), // fan out verdict per URL
  );
}

export function createBlockedRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.BlockedRelaysList).pipe(
    map((event) => getRelaysFromList(event)), // extract blocked relay URLs
    relayListStatus(), // fan out verdict per URL
  );
}

// ---------------------------------------------------------------------------
// Composed loader
// ---------------------------------------------------------------------------

/** Wraps a sub-loader for use in combineLatest — emits EMPTY_LIST immediately. */
function streaming(
  loader: Observable<RelayListState>,
): Observable<RelayListState> {
  return loader.pipe(
    startWith(EMPTY_LIST), // emit immediately so combineLatest doesn't stall
    catchError(() => of(EMPTY_LIST)), // map sub-loader errors to empty state
  );
}

export default function deadRelaysLoader(
  user: User,
): Observable<DeadRelaysState> {
  return combineLatest({
    outboxes: streaming(createOutboxesLoader(user)),
    inboxes: streaming(createInboxesLoader(user)),
    favoriteRelays: streaming(createFavoriteRelaysLoader(user)),
    searchRelays: streaming(createSearchRelaysLoader(user)),
    dmRelays: streaming(createDmRelaysLoader(user)),
    blockedRelays: streaming(createBlockedRelaysLoader(user)),
  }).pipe(
    takeUntil(timer(LOADER_TIMEOUT_MS)), // hard deadline for the combined stream
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
