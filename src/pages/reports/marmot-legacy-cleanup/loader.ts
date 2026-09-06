import type { User } from "applesauce-common/casts";
import { relaySet, type NostrEvent } from "applesauce-core/helpers";
import {
  combineLatest,
  map,
  shareReplay,
  startWith,
  takeUntil,
  timer,
} from "rxjs";
import { LOOKUP_RELAYS } from "../../../lib/relay.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { combineLatestByValue } from "../../../observable/operator/combine-latest-by-value.ts";
import { discoverOutboxes, requestRelayEvents } from "../marmot-loaders.ts";
import {
  LEGACY_KEY_PACKAGE_KIND,
  LEGACY_KEY_PACKAGE_RELAYS_KIND,
  type RelayFetch,
  readRelayList,
} from "../marmot-diagnostics.ts";

export type LegacyCleanupEvent = { event: NostrEvent; foundOnRelays: string[] };
export type LegacyCleanupState = {
  events: LegacyCleanupEvent[];
  queriedRelays: string[];
  incompleteRelays: string[];
  invalidRelayUrls: string[];
};

/** Legacy data is fetched solely to offer cleanup, never to assess readiness. */
export function createLoader(user: User) {
  const hints$ = discoverOutboxes(user).pipe(
    map((urls) => relaySet(urls, LOOKUP_RELAYS)),
  );
  const fetchRelay = (url: string) =>
    requestRelayEvents(url, {
      kinds: [LEGACY_KEY_PACKAGE_KIND, LEGACY_KEY_PACKAGE_RELAYS_KIND],
      authors: [user.pubkey],
    });
  const primary$ = hints$.pipe(
    combineLatestByValue(fetchRelay),
    startWith(new Map<string, RelayFetch>()),
    shareReplay(1),
  );
  // Use every observed signed legacy list, including older revisions on other
  // discovery relays. These URLs are cleanup hints, never current relay health.
  const relays$ = combineLatest({
    hints: hints$.pipe(startWith(LOOKUP_RELAYS)),
    primary: primary$,
  }).pipe(
    map(({ hints, primary }) => {
      const lists = [...primary.values()]
        .flatMap((fetch) => fetch.events)
        .filter((event) => event.kind === LEGACY_KEY_PACKAGE_RELAYS_KIND)
        .map(readRelayList);
      const urls = relaySet(hints, ...lists.map((list) => list.urls));
      return {
        urls,
        extra: urls.filter((url) => !hints.includes(url)),
        invalid: [...new Set(lists.flatMap((list) => list.invalidUrls))],
      };
    }),
    shareReplay(1),
  );
  const extra$ = relays$.pipe(
    map(({ extra }) => extra),
    combineLatestByValue(fetchRelay),
    startWith(new Map<string, RelayFetch>()),
  );
  const observed = new Map<string, LegacyCleanupEvent>();
  return combineLatest({
    relays: relays$.pipe(
      startWith({ urls: LOOKUP_RELAYS, invalid: [] as string[] }),
    ),
    primary: primary$,
    extra: extra$,
  }).pipe(
    map(({ relays, primary, extra }): LegacyCleanupState => {
      const fetches = new Map([...primary, ...extra]);
      for (const fetch of fetches.values()) {
        for (const event of fetch.events) {
          const previous = observed.get(event.id);
          observed.set(event.id, {
            event,
            foundOnRelays: relaySet(previous?.foundOnRelays, [fetch.relayUrl]),
          });
        }
      }
      return {
        events: [...observed.values()].sort(
          (a, b) =>
            b.event.created_at - a.event.created_at ||
            a.event.id.localeCompare(b.event.id),
        ),
        queriedRelays: relays.urls,
        incompleteRelays: relays.urls.filter((url) => {
          const fetch = fetches.get(url);
          return !fetch?.complete || fetch.error || !!fetch.invalidEvents;
        }),
        invalidRelayUrls: relays.invalid,
      };
    }),
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    shareReplay(1),
  );
}
