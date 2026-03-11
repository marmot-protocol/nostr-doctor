// ---------------------------------------------------------------------------
// DM Relay Auth loader
//
// Resolves the subject's kind:10050 DM relay list, then probes each relay for
// NIP-42 authentication enforcement on kind:1059 (gift wrap) reads.
//
// Pattern B: loadAddressableEvent → map → combineLatestBy →
//            relayUrls passthrough + combineLatestByIndex of probeRelayAuth
//
// State streams incrementally: relay list arrives first, then auth status
// fills in per relay as each probe completes or times out.
// The page layer applies takeUntil(timer(N)) + toLoaderState().
// ---------------------------------------------------------------------------

import type { User } from "applesauce-common/casts";
import { getRelaysFromList } from "applesauce-common/helpers";
import { kinds } from "applesauce-core/helpers";
import { of, type Observable } from "rxjs";
import {
  catchError,
  map,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs/operators";
import { loadAddressableEvent } from "../../../observable/loaders/load-addressable-event";
import { probeRelayAuth } from "../../../observable/loaders/probe-relay-auth";
import { combineLatestBy } from "../../../observable/operator/combine-latest-by.ts";
import { combineLatestByIndex } from "../../../observable/operator/combine-latest-by-index.ts";

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

export type AuthStatus = "protected" | "unprotected" | "unknown" | "loading";

export type DmRelayAuthState = {
  /**
   * DM relay URLs from kind:10050, or null if the event was not found.
   * An empty array means the event exists but lists no relays.
   */
  relayUrls: string[] | null;
  /**
   * Per-relay NIP-42 auth probe result.
   * "loading"     = probe still in progress
   * "protected"   = relay requires auth to read kind:1059
   * "unprotected" = relay served EOSE without requiring auth
   * "unknown"     = no response within PROBE_TIMEOUT_MS
   */
  authStatus: Record<string, AuthStatus>;
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function createLoader(user: User): Observable<DmRelayAuthState> {
  return loadAddressableEvent(user, kinds.DirectMessageRelaysList).pipe(
    map((list) => getRelaysFromList(list)), // extract relay URLs from DM relay list event
    combineLatestBy({
      relayUrls: map((relayUrls) => relayUrls), // pass relay URLs through unchanged
      authStatusByIndex: combineLatestByIndex(
        // probe each relay for NIP-42 auth in parallel
        switchMap((url) =>
          probeRelayAuth(url, user.pubkey).pipe(
            catchError(() => of("unknown" as AuthStatus)), // map probe errors to unknown
            startWith("loading" as AuthStatus), // initial value while probe runs
          ),
        ),
      ),
    }),
    map(({ relayUrls, authStatusByIndex }) => ({
      relayUrls,
      authStatus: Object.fromEntries(
        // reshape indexed results to a url-keyed record
        relayUrls.map((url, index) => [
          url,
          authStatusByIndex[index] ?? "loading",
        ]),
      ),
    })),
    catchError(() => of({ relayUrls: null, authStatus: {} })), // map top-level errors to null state
    shareReplay(1), // prevent re-execution on multiple subscribers
  );
}
