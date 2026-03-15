// ---------------------------------------------------------------------------
// Key Package Relay List loader (kind:10051)
//
// Fetches the subject's key package relay list (kind:10051), then checks
// each relay for:
//   1. online/offline verdict using NIP-66 monitors
//   2. kind:9 delete support via relay `supported_nips` metadata
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
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import {
  relayVerdict,
  type RelayVerdict,
} from "../../../lib/relay-monitors.ts";
import { DEFAULT_RELAYS, LOOKUP_RELAYS, pool } from "../../../lib/relay.ts";
import { eventLoader } from "../../../lib/store.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByValue } from "../../../observable/operator/combine-latest-by-value.ts";

// ---------------------------------------------------------------------------
// Kind constant — key package relay list
// ---------------------------------------------------------------------------

export const KEY_PACKAGE_RELAY_LIST_KIND = 10051;
export const DELETE_EVENT_KIND = 9;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type DeleteSupport = "supported" | "unsupported" | "unknown" | null;

export type KeyPackageRelayListState = {
  /** Relay URLs from kind:10051. null = event not found / still loading. */
  relayUrls: string[] | null;
  /** Per-relay online verdict. null = verdict still in progress. */
  verdicts: Record<string, RelayVerdict | null>;
  /** Per-relay kind:9 support from supported_nips. null = still loading. */
  deleteSupport: Record<string, DeleteSupport>;
};

const EMPTY_STATE: KeyPackageRelayListState = {
  relayUrls: null,
  verdicts: {},
  deleteSupport: {},
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<KeyPackageRelayListState> {
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
    // For each relay list, break into multiple streams
    combineLatestBy({
      // Pass through relay URLs
      relayUrls: map((urls) => urls),
      // Check online verdicts for each relay
      verdicts: combineLatestByValue((url) =>
        relayVerdict(url).pipe(
          catchError(() => of("unknown" as RelayVerdict)),
          // Ensure each relay branch emits immediately.
          startWith(null as RelayVerdict | null),
        ),
      ),
      // Check kind:9 support for each relay
      deleteSupport: combineLatestByValue((url) =>
        pool.relay(url).supported$.pipe(
          map((supportedNips) => {
            if (!Array.isArray(supportedNips)) return "unknown";
            return supportedNips.includes(DELETE_EVENT_KIND)
              ? "supported"
              : "unsupported";
          }),
          catchError(() => of("unknown" as DeleteSupport)),
          // Ensure each relay branch emits immediately.
          startWith(null as DeleteSupport),
        ),
      ),
    }),
    // Convert map results to objects
    map(({ relayUrls, verdicts, deleteSupport }) => ({
      relayUrls,
      verdicts: Object.fromEntries(verdicts.entries()),
      deleteSupport: Object.fromEntries(deleteSupport.entries()),
    })),
    // Catch all errors and return empty state
    catchError(() => of(EMPTY_STATE)),
    // Hard deadline
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    // Prevent re-execution on multiple subscribers
    shareReplay(1),
  );
}
