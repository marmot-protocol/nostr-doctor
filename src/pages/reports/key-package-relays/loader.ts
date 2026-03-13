// ---------------------------------------------------------------------------
// Key Package Relay List loader (kind:10051)
//
// Fetches the subject's key package relay list (kind:10051), then checks
// the online/offline verdict for each relay using NIP-66 monitors.
//
// State streams incrementally:
//   1. Relay URLs arrive once the kind:10051 event is found (or null if not found)
//   2. Per-relay verdicts fill in as monitors respond
//
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { relaySet } from "applesauce-core/helpers";
import { merge, of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  map,
  scan,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import { relayVerdict, type RelayVerdict } from "../../../lib/relay-monitors.ts";
import { DEFAULT_RELAYS, LOOKUP_RELAYS } from "../../../lib/relay.ts";
import { eventLoader } from "../../../lib/store.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";

// ---------------------------------------------------------------------------
// Kind constant — key package relay list
// ---------------------------------------------------------------------------

export const KEY_PACKAGE_RELAY_LIST_KIND = 10051;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type KeyPackageRelayListState = {
  /** Relay URLs from kind:10051. null = event not found / still loading. */
  relayUrls: string[] | null;
  /** Per-relay online verdict. null = verdict still in progress. */
  verdicts: Record<string, RelayVerdict | null>;
};

const EMPTY_STATE: KeyPackageRelayListState = {
  relayUrls: null,
  verdicts: {},
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(
  user: User,
): Observable<KeyPackageRelayListState> {
  // Load kind:10051 from outboxes + lookup + default relays
  const event$ = merge(
    user.outboxes$.pipe(
      switchMap((outboxes) =>
        eventLoader({
          kind: KEY_PACKAGE_RELAY_LIST_KIND,
          pubkey: user.pubkey,
          relays: relaySet(outboxes, LOOKUP_RELAYS, DEFAULT_RELAYS),
        }),
      ),
      catchError(() => of(null)),
    ),
    eventLoader({
      kind: KEY_PACKAGE_RELAY_LIST_KIND,
      pubkey: user.pubkey,
      relays: relaySet(LOOKUP_RELAYS, DEFAULT_RELAYS),
    }).pipe(catchError(() => of(null))),
  );

  return event$.pipe(
    map((event) => (event ? getRelaysFromList(event) : [])),
    switchMap((urls) => {
      const seed: KeyPackageRelayListState = {
        relayUrls: urls,
        verdicts: Object.fromEntries(urls.map((url) => [url, null])),
      };

      if (urls.length === 0) return of(seed);

      const patches$ = merge(
        ...urls.map((url) =>
          relayVerdict(url).pipe(
            catchError(() => of("unknown" as RelayVerdict)),
            map((verdict) => ({ url, verdict })),
          ),
        ),
      );

      return patches$.pipe(
        scan(
          (state, { url, verdict }) => ({
            ...state,
            verdicts: { ...state.verdicts, [url]: verdict },
          }),
          seed,
        ),
        startWith(seed),
      );
    }),
    catchError(() => of(EMPTY_STATE)),
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    shareReplay(1),
  );
}
