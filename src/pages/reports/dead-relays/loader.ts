// ---------------------------------------------------------------------------
// Dead Relays loader
//
// Checks all relay list types for dead (offline) relays, plus per-list
// capability checks:
//   - NIP-65 relays    (kind:10002) — read/write/both markers + online verdict
//   - Favorite relays  (kind:10012) — online verdict
//   - Search relays    (kind:10007) — online verdict + NIP-50 support check
//   - DM relays        (kind:10050) — online verdict + NIP-42 auth probe
//   - Blocked relays   (kind:10006) — online verdict
//   - Key package relays (kind:10051) — online verdict
//
// State streams incrementally as each sub-loader resolves.
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
  defaultIfEmpty,
  map,
  scan,
  startWith,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs/operators";
import {
  relayVerdict,
  type RelayVerdict,
} from "../../../lib/relay-monitors.ts";
import { pool } from "../../../lib/relay.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { loadAddressableEvent } from "../../../observable/loaders/load-addressable-event.ts";
import { probeRelayAuth } from "../../../observable/loaders/probe-relay-auth.ts";
import { KEY_PACKAGE_RELAY_LIST_KIND } from "../key-package-relays/loader.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_PROBE_TIMEOUT_MS = 10_000;
const AUTH_PROBE_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type RelayMarker = "read" | "write" | "both";

/** NIP-50 search support status */
export type SearchSupport = "supported" | "unsupported" | "unknown" | null;

/** NIP-42 auth enforcement status */
export type AuthStatus = "protected" | "unprotected" | "unknown" | null;

/** Per-relay capability data (filled in depending on list type) */
export type RelayCapabilities = {
  /** For search relays: NIP-50 support. null = not checked / still loading. */
  searchSupport?: SearchSupport;
  /** For DM relays: NIP-42 auth enforcement. null = not checked / still loading. */
  authStatus?: AuthStatus;
};

/** State for a single relay list entry. */
export type RelayEntry = {
  url: string;
  verdict: RelayVerdict | null;
  capabilities: RelayCapabilities;
};

/** State for a relay list. */
export type RelayListState = {
  /** null = event not yet found / still loading */
  urls: string[] | null;
  entries: Record<string, RelayEntry>;
};

/** State for the NIP-65 relay list with read/write/both markers. */
export type Nip65RelayListState = {
  urls: string[] | null;
  markers: Record<string, RelayMarker>;
  entries: Record<string, RelayEntry>;
};

/** Combined state across all relay list types. */
export type DeadRelaysState = {
  nip65: Nip65RelayListState;
  favoriteRelays: RelayListState;
  searchRelays: RelayListState;
  dmRelays: RelayListState;
  blockedRelays: RelayListState;
  keyPackageRelays: RelayListState;
};

const EMPTY_LIST: RelayListState = { urls: null, entries: {} };
const EMPTY_NIP65: Nip65RelayListState = {
  urls: null,
  markers: {},
  entries: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      markers[url] = "both";
    }
  }
  return markers;
}

// ---------------------------------------------------------------------------
// Per-relay probes
// ---------------------------------------------------------------------------

function probeSearchSupport(url: string): Observable<SearchSupport> {
  return pool
    .relay(url)
    .request({ kinds: [1], search: "nostr", limit: 1 })
    .pipe(
      map(() => "supported" as SearchSupport),
      defaultIfEmpty("supported" as SearchSupport),
      catchError(() => of("unsupported" as SearchSupport)),
      timeout({
        first: SEARCH_PROBE_TIMEOUT_MS,
        with: () => of("unknown" as SearchSupport),
      }),
      catchError(() => of("unknown" as SearchSupport)),
    );
}

// ---------------------------------------------------------------------------
// Core streaming operator
//
// Takes a stream of URL arrays and emits RelayListState updates as:
//   1. Each relay's online verdict resolves
//   2. Each relay's optional capability check resolves
//
// capabilityLoader: given a url, returns an Observable<RelayCapabilities>
//   that completes after the capability is known.
// ---------------------------------------------------------------------------

type CapabilityLoader = (url: string) => Observable<RelayCapabilities>;

function noCapabilities(): Observable<RelayCapabilities> {
  return of({});
}

function relayListStatus(
  capabilityLoader: CapabilityLoader = noCapabilities,
): OperatorFunction<string[], RelayListState> {
  return (source) =>
    source.pipe(
      switchMap((urls) => {
        const seed: RelayListState = {
          urls,
          entries: Object.fromEntries(
            urls.map((url) => [
              url,
              { url, verdict: null, capabilities: {} } satisfies RelayEntry,
            ]),
          ),
        };

        if (urls.length === 0) return of(seed);

        // Verdict patches — one per relay, complete independently
        const verdictPatches$ = merge(
          ...urls.map((url) =>
            relayVerdict(url).pipe(
              catchError(() => of("unknown" as RelayVerdict)),
              map((verdict) => ({ type: "verdict" as const, url, verdict })),
            ),
          ),
        );

        // Capability patches — one per relay, complete independently
        const capabilityPatches$ = merge(
          ...urls.map((url) =>
            capabilityLoader(url).pipe(
              catchError(() => of({} as RelayCapabilities)),
              map((capabilities) => ({
                type: "capability" as const,
                url,
                capabilities,
              })),
            ),
          ),
        );

        return merge(verdictPatches$, capabilityPatches$).pipe(
          scan((state, patch): RelayListState => {
            const prev = state.entries[patch.url] ?? {
              url: patch.url,
              verdict: null,
              capabilities: {},
            };
            if (patch.type === "verdict") {
              return {
                ...state,
                entries: {
                  ...state.entries,
                  [patch.url]: { ...prev, verdict: patch.verdict },
                },
              };
            } else {
              return {
                ...state,
                entries: {
                  ...state.entries,
                  [patch.url]: {
                    ...prev,
                    capabilities: {
                      ...prev.capabilities,
                      ...patch.capabilities,
                    },
                  },
                },
              };
            }
          }, seed),
          startWith(seed),
        );
      }),
    );
}

// ---------------------------------------------------------------------------
// Per-list sub-loaders
// ---------------------------------------------------------------------------

export function createNip65Loader(user: User): Observable<Nip65RelayListState> {
  return loadAddressableEvent(user, kinds.RelayList).pipe(
    switchMap((event) => {
      const markerMap = parseNip65Markers(event);
      const urls = Object.keys(markerMap);
      if (urls.length === 0) {
        return of({
          urls,
          markers: markerMap,
          entries: {},
        } as Nip65RelayListState);
      }
      return of(urls).pipe(
        relayListStatus(),
        map(({ urls: u, entries }) => ({
          urls: u,
          markers: markerMap,
          entries,
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
    relayListStatus((url) =>
      probeSearchSupport(url).pipe(
        map((searchSupport) => ({ searchSupport }) satisfies RelayCapabilities),
      ),
    ),
  );
}

export function createDmRelaysLoader(user: User): Observable<RelayListState> {
  return loadAddressableEvent(user, kinds.DirectMessageRelaysList).pipe(
    map((event) => getRelaysFromList(event)),
    relayListStatus((url) =>
      probeRelayAuth(url, user.pubkey).pipe(
        timeout({
          first: AUTH_PROBE_TIMEOUT_MS,
          with: () => of("unknown" as const),
        }),
        catchError(() => of("unknown" as const)),
        map((authStatus) => ({ authStatus }) satisfies RelayCapabilities),
      ),
    ),
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

export function createKeyPackageRelaysLoader(
  user: User,
): Observable<RelayListState> {
  return loadAddressableEvent(user, KEY_PACKAGE_RELAY_LIST_KIND).pipe(
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
    keyPackageRelays: streaming(createKeyPackageRelaysLoader(user)),
  }).pipe(takeUntil(timer(LOADER_TIMEOUT_MS)), shareReplay(1));
}
