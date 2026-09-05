import type { User } from "applesauce-common/casts";
import { relaySet, type NostrEvent } from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import { onlyEvents } from "applesauce-relay";
import { forkJoin, of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  first,
  map,
  startWith,
  switchMap,
  takeUntil,
  toArray,
} from "rxjs/operators";
import { LOOKUP_RELAYS, pool } from "../../../lib/relay.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { fetchRelayListUrls } from "../../../observable/operator/relay-loaders.ts";
import {
  CURRENT_KEY_PACKAGE_KIND,
  DELETE_EVENT_KIND,
  LEGACY_KEY_PACKAGE_KIND,
  LEGACY_KEY_PACKAGE_RELAYS_KIND,
  summarizeCurrentPackages,
  summarizeLegacyPackages,
  type CurrentKeyPackage,
  type LegacyKeyPackage,
  type RelayFetch,
} from "../marmot-diagnostics.ts";

export {
  CURRENT_KEY_PACKAGE_KIND,
  LEGACY_KEY_PACKAGE_KIND,
  LEGACY_KEY_PACKAGE_RELAYS_KIND,
};

export type KeyPackagesState = {
  nip65WriteRelays: string[];
  currentQueryRelays: string[];
  currentPackages: CurrentKeyPackage[];
  legacyRelayUrls: string[] | null;
  legacyPackages: LegacyKeyPackage[];
  fetching: boolean;
};

const EMPTY_STATE: KeyPackagesState = {
  nip65WriteRelays: [],
  currentQueryRelays: LOOKUP_RELAYS,
  currentPackages: [],
  legacyRelayUrls: null,
  legacyPackages: [],
  fetching: true,
};

function requestRelay(
  relayUrl: string,
  filter: { kinds: number[]; authors: string[] },
): Observable<RelayFetch> {
  return pool
    .relay(relayUrl)
    .request(filter)
    .pipe(
      onlyEvents(),
      toArray(),
      map((events: NostrEvent[]) => ({ relayUrl, events, error: false })),
      catchError(() =>
        of({ relayUrl, events: [] as NostrEvent[], error: true }),
      ),
    );
}

function requestRelays(
  relays: string[],
  filter: { kinds: number[]; authors: string[] },
): Observable<RelayFetch[]> {
  if (relays.length === 0) return of([]);
  return forkJoin(relays.map((relay) => requestRelay(relay, filter)));
}

export function createLoader(user: User): Observable<KeyPackagesState> {
  return user.outboxes$.pipe(
    defined(), // skip undefined (cache miss) and null
    first(), // take first cached outbox list and complete
    map((outboxes) => relaySet(outboxes)),
    switchMap((nip65WriteRelays) => {
      const currentQueryRelays = relaySet(nip65WriteRelays, LOOKUP_RELAYS);
      const legacyRelayUrls$ = fetchRelayListUrls(
        LEGACY_KEY_PACKAGE_RELAYS_KIND,
        user.pubkey,
        currentQueryRelays,
      );

      return legacyRelayUrls$.pipe(
        switchMap((legacyRelayUrls) => {
          const legacyQueryRelays = relaySet(
            legacyRelayUrls ?? [],
            currentQueryRelays,
          );
          return forkJoin({
            current: requestRelays(currentQueryRelays, {
              kinds: [CURRENT_KEY_PACKAGE_KIND, DELETE_EVENT_KIND],
              authors: [user.pubkey],
            }),
            legacy: requestRelays(legacyQueryRelays, {
              kinds: [LEGACY_KEY_PACKAGE_KIND],
              authors: [user.pubkey],
            }),
          }).pipe(
            map(
              ({ current, legacy }): KeyPackagesState => ({
                nip65WriteRelays,
                currentQueryRelays,
                currentPackages: summarizeCurrentPackages(
                  current,
                  nip65WriteRelays,
                  user.pubkey,
                  Math.floor(Date.now() / 1000),
                ),
                legacyRelayUrls,
                legacyPackages: summarizeLegacyPackages(legacy),
                fetching: false,
              }),
            ),
          );
        }),
      );
    }),
    startWith(EMPTY_STATE),
    catchError(() => of({ ...EMPTY_STATE, fetching: false })),
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    shareReplay(1),
  );
}
