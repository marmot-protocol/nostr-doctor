import {
  catchError,
  map,
  merge,
  of,
  take,
  timeout,
  type Observable,
} from "rxjs";
import { pool } from "../../lib/relay";

/** ms to wait for a per-relay NIP-42 auth probe before treating as unknown */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Probes a single relay for NIP-42 authentication by sending a kind:1059 REQ
 * tagged to the subject's pubkey, and watching relay.authRequiredForRead$.
 *
 * - "protected"   → relay sent CLOSED with auth-required in response to REQ
 * - "unprotected" → relay served EOSE (or an event) without requiring auth
 * - "unknown"     → no definitive response within PROBE_TIMEOUT_MS
 *
 * Completes after the first definitive result or the timeout.
 *
 * Uses relay.req() (low-level, no auto-retry/auto-auth) so we observe the
 * raw unauthenticated relay response.
 */
export function probeRelayAuth(
  url: string,
  pubkey: string,
): Observable<"protected" | "unprotected" | "unknown"> {
  const relay = pool.relay(url);

  return merge(
    // Watch for auth-required: fires if relay sends CLOSED with auth-required
    relay.authRequiredForRead$.pipe(
      catchError(() => of(false as boolean | undefined)),
      map((required) => (required === true ? ("protected" as const) : null)),
    ),
    // Send the probe REQ: kind:1059 p-tagged to subject
    relay.req({ kinds: [1059], "#p": [pubkey], limit: 1 }).pipe(
      // Any event or EOSE without auth = unprotected
      take(1),
      map(() => "unprotected" as const),
      catchError(() => of("unknown" as const)),
    ),
  ).pipe(
    // Filter out nulls from the authRequiredForRead$ branch
    // (it emits null when not yet required)
    catchError(() => of("unknown" as const)),
    // First definitive result wins
    map((v) => v ?? ("unknown" as const)),
    // Take the first non-null result
    take(1),
    // Hard deadline
    timeout({ first: PROBE_TIMEOUT_MS, with: () => of("unknown" as const) }),
    catchError(() => of("unknown" as const)),
  );
}
