import type { User } from "applesauce-common/casts";
import { relaySet } from "applesauce-core/helpers";
import {
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
  takeUntil,
  timer,
} from "rxjs";
import {
  relayVerdict,
  type RelayVerdict,
} from "../../../lib/relay-monitors.ts";
import { LOOKUP_RELAYS, pool } from "../../../lib/relay.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { combineLatestByValue } from "../../../observable/operator/combine-latest-by-value.ts";
import {
  discoverNip65,
  discoverRelayList,
  EMPTY_RELAY_LIST,
  requestRelayEvents,
} from "../marmot-loaders.ts";
import {
  CURRENT_INBOX_RELAYS_KIND,
  GIFT_WRAP_KIND,
} from "../marmot-diagnostics.ts";

export type DeleteSupport = "advertised" | "not-advertised" | "unknown";
export type WriteRelayDiagnostic = {
  verdict: RelayVerdict;
  deleteSupport: DeleteSupport;
};
export type RelayDiagnostic = {
  verdict: RelayVerdict;
  giftWrapCount: number;
  giftWrapRetrieval:
    | "observed"
    | "empty"
    | "error"
    | "unknown"
    | "auth-required";
  invalidEvents: number;
};
export const UNKNOWN_DIAGNOSTIC: RelayDiagnostic = {
  verdict: "unknown",
  giftWrapCount: 0,
  giftWrapRetrieval: "unknown",
  invalidEvents: 0,
};
export type KeyPackageRelayListState = {
  nip65WriteRelays: string[];
  invalidWriteUrls: string[];
  invalidInboxUrls: string[];
  discoveryComplete: boolean;
  writeRelays: Record<string, WriteRelayDiagnostic>;
  currentInboxRelayUrls: string[] | null | undefined;
  currentRelays: Record<string, RelayDiagnostic>;
};

function monitorVerdict(url: string) {
  return defer(() => relayVerdict(url)).pipe(
    catchError(() => of("unknown" as RelayVerdict)),
    startWith("unknown" as RelayVerdict),
  );
}
function inspectWriteRelay(url: string) {
  return combineLatest({
    verdict: monitorVerdict(url),
    deleteSupport: defer(() => pool.relay(url).supported$).pipe(
      map(
        (nips): DeleteSupport =>
          !Array.isArray(nips)
            ? "unknown"
            : nips.includes(9)
              ? "advertised"
              : "not-advertised",
      ),
      catchError(() => of("unknown" as DeleteSupport)),
      startWith("unknown" as DeleteSupport),
    ),
  });
}
function inspectInboxRelay(url: string, pubkey: string) {
  return combineLatest({
    verdict: monitorVerdict(url),
    giftWraps: requestRelayEvents(url, {
      kinds: [GIFT_WRAP_KIND],
      "#p": [pubkey],
    }).pipe(
      startWith({
        relayUrl: url,
        events: [],
        error: false,
        complete: false,
        invalidEvents: 0,
        authRequired: false,
      }),
    ),
  }).pipe(
    map(
      ({ verdict, giftWraps }): RelayDiagnostic => ({
        verdict,
        giftWrapCount: giftWraps.events.length,
        invalidEvents: giftWraps.invalidEvents ?? 0,
        giftWrapRetrieval: giftWraps.authRequired
          ? "auth-required"
          : giftWraps.error
            ? "error"
            : giftWraps.events.length > 0
              ? "observed"
              : giftWraps.complete && !giftWraps.invalidEvents
                ? "empty"
                : "unknown",
      }),
    ),
  );
}

export function createLoader(user: User) {
  const nip65$ = discoverNip65(user);
  const outboxes$ = nip65$.pipe(
    map((list) => relaySet(list.urls)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );
  const hints$ = outboxes$.pipe(map((urls) => relaySet(urls, LOOKUP_RELAYS)));
  const inbox$ = discoverRelayList(
    user.pubkey,
    CURRENT_INBOX_RELAYS_KIND,
    hints$,
  );
  const writeChecks$ = outboxes$.pipe(
    combineLatestByValue(inspectWriteRelay),
    startWith(new Map<string, WriteRelayDiagnostic>()),
  );
  const inboxChecks$ = inbox$.pipe(
    map((list) => relaySet(list.urls)),
    combineLatestByValue((url) => inspectInboxRelay(url, user.pubkey)),
    startWith(new Map<string, RelayDiagnostic>()),
  );

  return combineLatest({
    nip65: nip65$.pipe(startWith(EMPTY_RELAY_LIST)),
    inbox: inbox$.pipe(startWith(EMPTY_RELAY_LIST)),
    writes: writeChecks$,
    inboxes: inboxChecks$,
  }).pipe(
    map(
      ({ nip65, inbox, writes, inboxes }): KeyPackageRelayListState => ({
        nip65WriteRelays: relaySet(nip65.urls),
        invalidWriteUrls: nip65.invalidUrls,
        invalidInboxUrls: inbox.invalidUrls,
        discoveryComplete: nip65.complete && inbox.complete,
        writeRelays: Object.fromEntries(writes),
        currentInboxRelayUrls: inbox.event
          ? relaySet(inbox.urls)
          : inbox.complete
            ? null
            : undefined,
        currentRelays: Object.fromEntries(inboxes),
      }),
    ),
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    shareReplay(1),
  );
}
