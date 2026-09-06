import { verifySignedEvent } from "../../lib/marmot/verify-signed-event.ts";
import type { User } from "applesauce-common/casts";
import {
  relaySet,
  matchFilter,
  type NostrEvent,
  type Filter,
} from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import { onlyEvents, ReqCloseError } from "applesauce-relay";
import {
  catchError,
  defer,
  distinctUntilChanged,
  first,
  map,
  materialize,
  of,
  scan,
  shareReplay,
  startWith,
  takeUntil,
  timeout,
  timer,
  switchMap,
  endWith,
  throwError,
  type Observable,
} from "rxjs";
import { pool, LOOKUP_RELAYS } from "../../lib/relay.ts";
import {
  OUTBOX_LOAD_TIMEOUT_MS,
  RELAY_REQUEST_TIMEOUT_MS,
} from "../../lib/timeouts.ts";
import {
  isMarmotRelayUrl,
  readRelayList,
  NIP65_RELAY_LIST_KIND,
  type RelayFetch,
} from "./marmot-diagnostics.ts";
import { eventLoader } from "../../lib/store.ts";

/** Query lookup relays immediately, adding discovered outboxes without blocking. */
function outboxHints(user: User) {
  return user.outboxes$.pipe(
    defined(),
    first(),
    timeout({ first: OUTBOX_LOAD_TIMEOUT_MS, with: () => of([] as string[]) }),
    catchError(() => of([] as string[])),
    map((outboxes) => relaySet(outboxes.filter(isMarmotRelayUrl))),
    startWith([] as string[]),
    distinctUntilChanged((a, b) => a.join("\n") === b.join("\n")),
    shareReplay(1),
  );
}

/** Keep received events even if a relay errors or never sends EOSE. */
export function requestRelayEvents(relayUrl: string, filter: Filter) {
  const initial: RelayFetch = {
    relayUrl,
    events: [],
    error: false,
    complete: false,
    invalidEvents: 0,
    authRequired: false,
  };
  return defer(() => {
    if (!isMarmotRelayUrl(relayUrl)) throw new Error("Invalid relay URL");
    const relay = pool.relay(relayUrl);
    return relay.authRequiredForRead$.pipe(
      first(),
      switchMap((required) =>
        required
          ? throwError(
              () =>
                new ReqCloseError(
                  "auth-required: recipient authentication needed",
                ),
            )
          : relay.request(filter, { reconnect: false }),
      ),
    );
  }).pipe(
    onlyEvents(),
    materialize(),
    scan((state: RelayFetch, notification): RelayFetch => {
      if (notification.kind === "N") {
        const event = notification.value;
        if (!isVerifiedEvent(event, filter))
          return { ...state, invalidEvents: (state.invalidEvents ?? 0) + 1 };
        return state.events.some((existing) => existing.id === event.id)
          ? state
          : { ...state, events: [...state.events, event] };
      }
      return {
        ...state,
        complete: true,
        error: notification.kind === "E",
        authRequired:
          notification.kind === "E" &&
          notification.error instanceof ReqCloseError &&
          notification.error.message.startsWith("auth-required:"),
      };
    }, initial),
    // An interrupted request remains incomplete, never evidence of absence.
    takeUntil(timer(RELAY_REQUEST_TIMEOUT_MS)),
    startWith(initial),
  );
}

export function isVerifiedEvent(event: NostrEvent, filter: Filter): boolean {
  try {
    return verifySignedEvent(event) && matchFilter(filter, event);
  } catch {
    return false;
  }
}

export type RelayListDiscovery = {
  event: NostrEvent | null;
  urls: string[];
  invalidUrls: string[];
  complete: boolean;
  invalidEvents: number;
};
export const EMPTY_RELAY_LIST: RelayListDiscovery = {
  event: null,
  urls: [],
  invalidUrls: [],
  complete: false,
  invalidEvents: 0,
};

/** Keep the newest signed list, including data received before a timeout/error. */
export function discoverRelayList(
  pubkey: string,
  kind: number,
  hints$: Observable<string[]>,
) {
  type Update = { event?: NostrEvent; complete?: boolean };
  return hints$.pipe(
    switchMap((relays) =>
      defer(() => eventLoader({ kind, pubkey, relays, cache: false })).pipe(
        map((event): Update => ({ event })),
        endWith({ complete: true } as Update),
        catchError(() => of({ complete: false } as Update)),
        startWith({ complete: false } as Update),
      ),
    ),
    scan((state: RelayListDiscovery, update): RelayListDiscovery => {
      const event = update.event;
      if (!event)
        return {
          ...state,
          // The shared loader suppresses upstream relay errors. An empty
          // completion therefore cannot prove that an account has no list.
          complete:
            (update.complete ?? false) &&
            state.event !== null &&
            state.invalidEvents === 0,
        };
      if (!isVerifiedEvent(event, { kinds: [kind], authors: [pubkey] }))
        return {
          ...state,
          complete: false,
          invalidEvents: state.invalidEvents + 1,
        };
      if (
        state.event &&
        (state.event.created_at > event.created_at ||
          (state.event.created_at === event.created_at &&
            state.event.id <= event.id))
      )
        return state;
      return { ...state, event, ...readRelayList(event), complete: false };
    }, EMPTY_RELAY_LIST),
    startWith(EMPTY_RELAY_LIST),
    takeUntil(timer(RELAY_REQUEST_TIMEOUT_MS)),
    shareReplay(1),
  );
}

export function discoverNip65(user: User) {
  return discoverRelayList(
    user.pubkey,
    NIP65_RELAY_LIST_KIND,
    outboxHints(user).pipe(
      map((outboxes) => relaySet(outboxes, LOOKUP_RELAYS)),
    ),
  );
}

export function discoverOutboxes(user: User) {
  return discoverNip65(user).pipe(
    map((list) => relaySet(list.urls)),
    distinctUntilChanged((a, b) => a.join("\n") === b.join("\n")),
    shareReplay(1),
  );
}
