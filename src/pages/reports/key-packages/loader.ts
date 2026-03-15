// ---------------------------------------------------------------------------
// Key Packages loader (kind:443)
//
// Fetches MLS key package events (kind:443) authored by the subject from:
//   1. Their key package relay list (kind:10051) — primary source
//   2. Their outbox relays (kind:10002 writes)
//   3. Default + lookup relays
//
// Streams packages as they arrive from any relay. Deduplicates by event id.
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import type { NostrEvent } from "applesauce-core/helpers";
import { relaySet } from "applesauce-core/helpers";
import { onlyEvents } from "applesauce-relay";
import { EMPTY, merge, type Observable, of, shareReplay, timer } from "rxjs";
import {
  catchError,
  map,
  scan,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import { DEFAULT_RELAYS, LOOKUP_RELAYS, pool } from "../../../lib/relay.ts";
import { eventLoader, eventStore } from "../../../lib/store.ts";
import { LOADER_TIMEOUT_MS } from "../../../lib/timeouts.ts";

// ---------------------------------------------------------------------------
// Kind constants
// ---------------------------------------------------------------------------

export const KEY_PACKAGE_KIND = 443;
export const KEY_PACKAGE_RELAY_LIST_KIND = 10051;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/** Parsed info from a single kind:443 event. */
export type KeyPackage = {
  id: string;
  /** The raw event */
  event: NostrEvent;
  /** Client name from `client` tag, if present */
  client: string | null;
  /** Device/label from `device` or `d` tag, if present */
  device: string | null;
  /** Creation timestamp */
  createdAt: number;
  /** Which relay URL this was found on (first seen) */
  foundOnRelay: string | null;
};

export type KeyPackagesState = {
  /** Relay URLs from kind:10051, or null if list not found */
  keyPackageRelays: string[] | null;
  /** All unique key packages found, newest first */
  packages: KeyPackage[];
  /** True while we're still fetching */
  fetching: boolean;
};

const EMPTY_STATE: KeyPackagesState = {
  keyPackageRelays: null,
  packages: [],
  fetching: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseKeyPackage(
  event: NostrEvent,
  relayUrl: string | null,
): KeyPackage {
  const clientTag = event.tags.find((t) => t[0] === "client");
  const deviceTag = event.tags.find((t) => t[0] === "device") ??
    event.tags.find((t) => t[0] === "d");

  return {
    id: event.id,
    event,
    client: clientTag?.[1] ?? null,
    device: deviceTag?.[1] ?? null,
    createdAt: event.created_at,
    foundOnRelay: relayUrl,
  };
}

function requestFromRelay(
  url: string,
  pubkey: string,
): Observable<{ event: NostrEvent; relayUrl: string }> {
  return pool
    .relay(url)
    .request({ kinds: [KEY_PACKAGE_KIND], authors: [pubkey] })
    .pipe(
      // Select only events
      onlyEvents(),
      // Collect event and relay URL
      map((event) => ({ event, relayUrl: url })),
      // Ignore errors
      catchError(() => EMPTY),
    );
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<KeyPackagesState> {
  // Step 1: resolve key package relay list (kind:10051)
  const keyPackageRelays$ = merge(
    // Subscribe to users outboxes first
    user.outboxes$.pipe(
      switchMap((outboxes) =>
        // Then request the relay list event from the outboxes
        eventLoader({
          kind: KEY_PACKAGE_RELAY_LIST_KIND,
          pubkey: user.pubkey,
          relays: relaySet(outboxes, LOOKUP_RELAYS, DEFAULT_RELAYS),
        })
      ),
      catchError(() => of(null)),
    ),
    // Request the relay list event from the default and lookup relays
    eventLoader({
      kind: KEY_PACKAGE_RELAY_LIST_KIND,
      pubkey: user.pubkey,
      relays: relaySet(LOOKUP_RELAYS, DEFAULT_RELAYS),
    }).pipe(catchError(() => of(null))),
  ).pipe(
    // Also check the event store cache
    startWith(
      eventStore.getReplaceable(KEY_PACKAGE_RELAY_LIST_KIND, user.pubkey) ??
        null,
    ),
    // Parse the relays from the list
    map((event) => ({
      event,
      urls: event ? getRelaysFromList(event) : [],
    })),
    // Only make one upstream request
    shareReplay(1),
  );

  // Step 2: fetch kind:443 events from all relay sources in parallel
  const packages$ = merge(
    // From key package relay list relays
    keyPackageRelays$.pipe(
      switchMap(({ urls }) => {
        if (urls.length === 0) return EMPTY;
        return merge(...urls.map((url) => requestFromRelay(url, user.pubkey)));
      }),
      catchError(() => EMPTY),
    ),
    // From outbox relays
    user.outboxes$.pipe(
      switchMap((outboxes) => {
        const urls = outboxes ?? [];
        if (urls.length === 0) return EMPTY;

        // Request all key package events
        return merge(...urls.map((url) => requestFromRelay(url, user.pubkey)));
      }),
      catchError(() => EMPTY),
    ),
    // From default + lookup relays
    merge(
      ...relaySet(DEFAULT_RELAYS, LOOKUP_RELAYS).map((url) =>
        requestFromRelay(url, user.pubkey)
      ),
    ).pipe(catchError(() => EMPTY)),
  );

  return keyPackageRelays$.pipe(
    switchMap(({ urls: keyPackageRelays }) => {
      return packages$.pipe(
        // Collect events and relay URLs
        scan(
          (state, { event, relayUrl }) => {
            // Deduplicate by event id
            if (state.packages.some((p) => p.id === event.id)) return state;
            const pkg = parseKeyPackage(event, relayUrl);
            const packages = [pkg, ...state.packages].sort(
              (a, b) => b.createdAt - a.createdAt,
            );
            return { ...state, packages };
          },
          {
            keyPackageRelays: keyPackageRelays.length > 0
              ? keyPackageRelays
              : null,
            packages: [] as KeyPackage[],
            fetching: true,
          } as KeyPackagesState,
        ),
        startWith({
          keyPackageRelays: keyPackageRelays.length > 0
            ? keyPackageRelays
            : null,
          packages: [] as KeyPackage[],
          fetching: true,
        } as KeyPackagesState),
      );
    }),
    // Catch all errors and return empty state
    catchError(() => of(EMPTY_STATE)),
    // Hard deadline
    takeUntil(timer(LOADER_TIMEOUT_MS)),
    // Prevent re-execution on multiple subscribers
    shareReplay(1),
  );
}
