import type { User } from "applesauce-common/casts";
import { relaySet } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers";
import { validateInWorker } from "../../../lib/marmot/validate-in-worker.ts";
import type { KeyPackageValidation } from "../../../lib/marmot/key-package-validation.ts";
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
  CURRENT_KEY_PACKAGE_KIND,
  DELETE_EVENT_KIND,
  summarizeCurrentPackages,
  type CurrentKeyPackage,
  type RelayFetch,
} from "../marmot-diagnostics.ts";

export { CURRENT_KEY_PACKAGE_KIND };

export type KeyPackagesState = {
  nip65WriteRelays: string[];
  currentQueryRelays: string[];
  currentPackages: CurrentKeyPackage[];
  incompleteRelays: string[];
};

export function createLoader(user: User) {
  const outboxes$ = discoverOutboxes(user);
  const queryRelays$ = outboxes$.pipe(
    map((outboxes) => relaySet(outboxes, LOOKUP_RELAYS)),
  );
  const current$ = queryRelays$.pipe(
    combineLatestByValue((relay) =>
      requestRelayEvents(relay, {
        kinds: [CURRENT_KEY_PACKAGE_KIND, DELETE_EVENT_KIND],
        authors: [user.pubkey],
      }),
    ),
    startWith(new Map<string, RelayFetch>()),
    shareReplay(1),
  );
  const eventsById = new Map<string, NostrEvent>();
  const validations$ = current$.pipe(
    map((fetches) => {
      for (const fetch of fetches.values())
        for (const event of fetch.events) {
          if (event.kind === CURRENT_KEY_PACKAGE_KIND)
            eventsById.set(event.id, event);
        }
      return [...eventsById.values()]
        .sort((a, b) => b.created_at - a.created_at)
        .map((event) => event.id);
    }),
    combineLatestByValue((id) =>
      validateInWorker(eventsById.get(id)!, user.pubkey).pipe(
        startWith(undefined),
      ),
    ),
    startWith(new Map<string, KeyPackageValidation | undefined>()),
  );

  return combineLatest({
    outboxes: outboxes$.pipe(startWith([] as string[])),
    current: current$,
    validations: validations$,
  }).pipe(
    map(({ outboxes, current, validations }): KeyPackagesState => {
      const fetches = [...current.values()];
      return {
        nip65WriteRelays: outboxes,
        currentQueryRelays: relaySet(outboxes, LOOKUP_RELAYS),
        currentPackages: summarizeCurrentPackages(
          fetches,
          outboxes,
          user.pubkey,
          Math.floor(Date.now() / 1000),
          validations,
        ),
        incompleteRelays: fetches
          .filter(
            (fetch) => !fetch.complete || fetch.error || fetch.invalidEvents,
          )
          .map((fetch) => fetch.relayUrl),
      };
    }),
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    shareReplay(1),
  );
}
