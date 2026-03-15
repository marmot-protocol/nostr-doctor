// ---------------------------------------------------------------------------
// Blossom Servers loader (kind:10063)
//
// Fetches the subject's Blossom server list using an outbox-first relay
// strategy, then checks each server's HTTP root endpoint (GET /).
//
// Online verdict rule:
//   - response.ok === true  -> "online"
//   - network / non-2xx     -> "offline"
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import {
  BLOSSOM_SERVER_LIST_KIND,
  getBlossomServersFromList,
} from "applesauce-common/helpers/blossom";
import { relaySet } from "applesauce-core/helpers";
import { from, merge, of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  map,
  startWith,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs/operators";
import { DEFAULT_RELAYS, LOOKUP_RELAYS } from "../../../lib/relay.ts";
import { eventLoader } from "../../../lib/store.ts";
import {
  LOADER_TIMEOUT_MS,
  RELAY_REQUEST_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByValue } from "../../../observable/operator/combine-latest-by-value.ts";

export type BlossomServerStatus = "online" | "offline" | null;

export type BlossomServersState = {
  /** null = list event not found / still loading */
  serverUrls: string[] | null;
  /** Per-server online verdict. null = still checking. */
  statusByUrl: Record<string, BlossomServerStatus>;
};

const EMPTY_STATE: BlossomServersState = {
  serverUrls: null,
  statusByUrl: {},
};

function checkServer(url: string): Observable<BlossomServerStatus> {
  return from(fetch(new URL("/", url).toString())).pipe(
    timeout({
      first: RELAY_REQUEST_TIMEOUT_MS,
      with: () => of(new Response(null, { status: 504 })),
    }),
    map((response) => (response.ok ? "online" : "offline")),
    catchError(() => of("offline" as const)),
  );
}

export function createLoader(user: User): Observable<BlossomServersState> {
  const event$ = merge(
    user.outboxes$.pipe(
      switchMap((outboxes) =>
        eventLoader({
          kind: BLOSSOM_SERVER_LIST_KIND,
          pubkey: user.pubkey,
          relays: relaySet(outboxes, LOOKUP_RELAYS, DEFAULT_RELAYS),
        }),
      ),
      catchError(() => of(null)),
    ),
    eventLoader({
      kind: BLOSSOM_SERVER_LIST_KIND,
      pubkey: user.pubkey,
      relays: relaySet(LOOKUP_RELAYS, DEFAULT_RELAYS),
    }).pipe(catchError(() => of(null))),
  );

  return event$.pipe(
    map((event) => {
      if (!event) return null;
      const urls = getBlossomServersFromList(event).map((url) =>
        url.toString(),
      );
      return Array.from(new Set(urls));
    }),
    switchMap((serverUrls) => {
      if (serverUrls === null) return of(EMPTY_STATE);
      return of(serverUrls).pipe(
        combineLatestBy({
          serverUrls: map((urls) => urls),
          statusByUrl: combineLatestByValue((url) =>
            checkServer(url).pipe(startWith(null as BlossomServerStatus)),
          ),
        }),
        map(
          ({ serverUrls: urls, statusByUrl }): BlossomServersState => ({
            serverUrls: urls,
            statusByUrl: Object.fromEntries(statusByUrl.entries()),
          }),
        ),
      );
    }),
    catchError(() => of(EMPTY_STATE)),
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    shareReplay(1),
  );
}
