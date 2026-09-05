import type { User } from "applesauce-common/casts";
import { relaySet } from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import { onlyEvents } from "applesauce-relay";
import { forkJoin, of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  first,
  last,
  map,
  startWith,
  switchMap,
  takeUntil,
  toArray,
} from "rxjs/operators";
import {
  relayVerdict,
  type RelayVerdict,
} from "../../../lib/relay-monitors.ts";
import { LOOKUP_RELAYS, pool } from "../../../lib/relay.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { fetchRelayListUrls } from "../../../observable/operator/relay-loaders.ts";
import {
  CURRENT_INBOX_RELAYS_KIND,
  DELETE_EVENT_KIND,
  LEGACY_KEY_PACKAGE_RELAYS_KIND,
  WELCOME_KIND,
} from "../marmot-diagnostics.ts";

export {
  CURRENT_INBOX_RELAYS_KIND,
  DELETE_EVENT_KIND,
  LEGACY_KEY_PACKAGE_RELAYS_KIND,
  WELCOME_KIND,
};

const NIP09 = 9;

export type DeleteSupport = "supported" | "unsupported" | "unknown";

export type RelayDiagnostic = {
  verdict: RelayVerdict;
  deleteSupport: DeleteSupport;
  welcomeCount: number;
  welcomeReachability: "reachable" | "empty" | "error";
};

export type KeyPackageRelayListState = {
  nip65WriteRelays: string[];
  currentInboxRelayUrls: string[] | null;
  currentRelays: Record<string, RelayDiagnostic>;
  legacyRelayUrls: string[] | null;
  legacyVerdicts: Record<string, RelayVerdict>;
  fetching: boolean;
};

const EMPTY_STATE: KeyPackageRelayListState = {
  nip65WriteRelays: [],
  currentInboxRelayUrls: null,
  currentRelays: {},
  legacyRelayUrls: null,
  legacyVerdicts: {},
  fetching: true,
};

function inspectCurrentRelay(
  relayUrl: string,
  pubkey: string,
): Observable<[string, RelayDiagnostic]> {
  const verdict$ = relayVerdict(relayUrl).pipe(
    last(undefined, "unknown" as RelayVerdict),
    catchError(() => of("unknown" as RelayVerdict)),
  );
  const deleteSupport$ = pool.relay(relayUrl).supported$.pipe(
    last(null),
    map((supportedNips) => {
      if (!Array.isArray(supportedNips)) return "unknown" as const;
      return supportedNips.includes(NIP09)
        ? ("supported" as const)
        : ("unsupported" as const);
    }),
    catchError(() => of("unknown" as const)),
  );
  const welcomes$ = pool
    .relay(relayUrl)
    .request({ kinds: [WELCOME_KIND], "#p": [pubkey] })
    .pipe(
      onlyEvents(),
      toArray(),
      map((events) => ({ count: events.length, error: false })),
      catchError(() => of({ count: 0, error: true })),
    );

  return forkJoin({
    verdict: verdict$,
    deleteSupport: deleteSupport$,
    welcomes: welcomes$,
  }).pipe(
    map(({ verdict, deleteSupport, welcomes }) => [
      relayUrl,
      {
        verdict,
        deleteSupport,
        welcomeCount: welcomes.count,
        welcomeReachability: welcomes.error
          ? "error"
          : welcomes.count > 0
            ? "reachable"
            : "empty",
      },
    ]),
  );
}

function inspectLegacyRelay(
  relayUrl: string,
): Observable<[string, RelayVerdict]> {
  return relayVerdict(relayUrl).pipe(
    last(undefined, "unknown" as RelayVerdict),
    catchError(() => of("unknown" as RelayVerdict)),
    map((verdict) => [relayUrl, verdict]),
  );
}

export function createLoader(user: User): Observable<KeyPackageRelayListState> {
  return user.outboxes$.pipe(
    defined(), // skip undefined (cache miss) and null
    first(), // take first cached outbox list and complete
    map((outboxes) => relaySet(outboxes)),
    switchMap((nip65WriteRelays) => {
      const lookupRelays = relaySet(nip65WriteRelays, LOOKUP_RELAYS);
      return forkJoin({
        currentInboxRelayUrls: fetchRelayListUrls(
          CURRENT_INBOX_RELAYS_KIND,
          user.pubkey,
          lookupRelays,
        ),
        legacyRelayUrls: fetchRelayListUrls(
          LEGACY_KEY_PACKAGE_RELAYS_KIND,
          user.pubkey,
          lookupRelays,
        ),
      }).pipe(
        switchMap(({ currentInboxRelayUrls, legacyRelayUrls }) => {
          const currentChecks = (currentInboxRelayUrls ?? []).map((relay) =>
            inspectCurrentRelay(relay, user.pubkey),
          );
          const legacyChecks = (legacyRelayUrls ?? []).map(inspectLegacyRelay);
          return forkJoin({
            current:
              currentChecks.length > 0 ? forkJoin(currentChecks) : of([]),
            legacy: legacyChecks.length > 0 ? forkJoin(legacyChecks) : of([]),
          }).pipe(
            map(
              ({ current, legacy }): KeyPackageRelayListState => ({
                nip65WriteRelays,
                currentInboxRelayUrls,
                currentRelays: Object.fromEntries(current),
                legacyRelayUrls,
                legacyVerdicts: Object.fromEntries(legacy),
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
