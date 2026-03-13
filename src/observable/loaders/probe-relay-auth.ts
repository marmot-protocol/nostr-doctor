import { catchError, map, of, take, timeout, type Observable } from "rxjs";
import { ReqCloseError } from "applesauce-relay";
import { pool } from "../../lib/relay";

/** ms to wait for a per-relay NIP-42 auth probe before treating as unknown */
const PROBE_TIMEOUT_MS = 10_000;

/** Prefix used by relays in CLOSED messages that require authentication */
const AUTH_REQUIRED_PREFIX = "auth-required:";

/**
 * Probes a single relay for NIP-42 authentication by sending a kind:1059 REQ
 * tagged to the subject's pubkey.
 *
 * - "protected"   → relay sent CLOSED with auth-required in response to REQ
 * - "unprotected" → relay served EOSE (or an event) without requiring auth
 * - "unknown"     → no definitive response within PROBE_TIMEOUT_MS
 *
 * Completes after the first definitive result or the timeout.
 *
 * NOTE: We read the CLOSED error directly from the ReqCloseError rather than
 * watching authRequiredForRead$. The relay.req() call wraps the observable
 * with waitForAuth(authRequiredForRead$, ...) which means:
 *   (a) if authRequiredForRead$ is already true (from a prior probe session),
 *       req() hangs waiting for auth — never producing a result, timing out
 *       and yielding "unknown".
 *   (b) even when auth-required CLOSED arrives fresh, the catchError branch
 *       can race against authRequiredForRead$ and emit "unknown" first.
 *
 * Inspecting ReqCloseError directly avoids both races cleanly.
 */
export function probeRelayAuth(
  url: string,
  pubkey: string,
): Observable<"protected" | "unprotected" | "unknown"> {
  const relay = pool.relay(url);

  return relay.req({ kinds: [1059], "#p": [pubkey], limit: 1 }).pipe(
    // Any event or EOSE without auth = unprotected
    take(1),
    map(() => "unprotected" as const),
    catchError((err) => {
      // CLOSED with "auth-required:" prefix → relay is protected
      if (
        err instanceof ReqCloseError &&
        err.message.startsWith(AUTH_REQUIRED_PREFIX)
      ) {
        return of("protected" as const);
      }
      // Any other error (connection refused, relay error, etc.) → unknown
      return of("unknown" as const);
    }),
    // Hard deadline — if relay never responds, treat as unknown
    timeout({ first: PROBE_TIMEOUT_MS, with: () => of("unknown" as const) }),
    catchError(() => of("unknown" as const)),
  );
}
