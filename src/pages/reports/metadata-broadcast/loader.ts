// ---------------------------------------------------------------------------
// Metadata Broadcast loader
//
// Checks which metadata events (kinds 0, 3, 10002, 10050, 10063) are present
// on each of the subject's outbox relays, producing a per-relay coverage map
// that the page uses to decide what needs to be broadcast.
//
// Pattern D: user.outboxes$ → defined() + first() → switchMap →
//            combineLatestBy relayUrls + combineLatestByIndex of per-relay scan
//
// Each per-relay stream accumulates the best event per kind as they arrive,
// then cuts at RELAY_REQUEST_TIMEOUT_MS. State updates relay-by-relay and
// event-by-event as coverage fills in.
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import type { NostrEvent } from "applesauce-core/helpers";
import { relaySet } from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import { of, shareReplay, timer, type Observable } from "rxjs";
import {
  catchError,
  first,
  map,
  scan,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import { LOOKUP_RELAYS, pool } from "../../../lib/relay.ts";
import { RELAY_REQUEST_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByIndex } from "../../../observable/operator/combine-latest-by-index.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const METADATA_KINDS = [0, 3, 10002, 10050, 10063] as const;

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

export type MetadataBroadcastState = {
  /** All relay URLs being checked (deduped union of outboxes + LOOKUP_RELAYS). */
  allRelays: string[];
  /**
   * Per-relay, per-kind coverage map.
   * relayUrl → kind → best NostrEvent found on that relay.
   * A missing kind entry means it was not found on that relay.
   */
  relayKindMap: Map<string, Map<number, NostrEvent>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Streams events from one relay and accumulates the best event per kind. */
function relayKindScan(
  url: string,
  pubkey: string,
): Observable<Map<number, NostrEvent>> {
  return pool
    .relay(url)
    .request({ kinds: [...METADATA_KINDS], authors: [pubkey] })
    .pipe(
      takeUntil(timer(RELAY_REQUEST_TIMEOUT_MS)), // cut at per-relay deadline
      scan((kindMap, event) => {
        // accumulate best event per kind
        const next = new Map(kindMap);
        const existing = next.get(event.kind);
        if (existing === undefined || event.created_at > existing.created_at) {
          next.set(event.kind, event);
        }
        return next;
      }, new Map<number, NostrEvent>()),
      catchError(() => of(new Map<number, NostrEvent>())), // map relay errors to empty map
      startWith(new Map<number, NostrEvent>()), // emit immediately for combineLatestByIndex
    );
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<MetadataBroadcastState> {
  return user.outboxes$.pipe(
    defined(), // skip undefined (cache miss) and null
    first(), // take first cached outbox list and complete
    switchMap((outboxes) => {
      const allRelays = relaySet(outboxes, LOOKUP_RELAYS); // merge + dedup relay sources

      return of(allRelays).pipe(
        combineLatestBy({
          allRelays: map((relays) => relays), // pass relay list through unchanged
          kindMapsByIndex: combineLatestByIndex(
            // stream coverage per relay in parallel
            switchMap((url) => relayKindScan(url, user.pubkey)),
          ),
        }),
        map(({ allRelays: relays, kindMapsByIndex }) => ({
          allRelays: relays,
          relayKindMap: new Map( // reshape indexed results to a url-keyed map
            relays.map((url, index) => [
              url,
              kindMapsByIndex[index] ?? new Map(),
            ]),
          ),
        })),
        catchError(() =>
          of({
            allRelays,
            relayKindMap: new Map<string, Map<number, NostrEvent>>(),
          }),
        ),
      );
    }),
    catchError(() =>
      of({
        allRelays: [],
        relayKindMap: new Map<string, Map<number, NostrEvent>>(),
      }),
    ), // map outbox errors to empty state
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
