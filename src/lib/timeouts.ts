// ---------------------------------------------------------------------------
// Shared timeout constants for report pages
//
// Import from here instead of declaring local constants in each report file.
// All values are in milliseconds.
// ---------------------------------------------------------------------------

/**
 * How long to wait for a Nostr event (kind:0, kind:3, kind:10007, kind:10002,
 * etc.) to arrive from relays before treating it as not found.
 * Applied as an RxJS `timeout` operator on the event stream.
 */
export const EVENT_LOAD_TIMEOUT_MS = 10_000;

/**
 * How long to wait for the subject's outbox relay list (kind:10002 write
 * relays) before proceeding with fallback relays only.
 * Shorter than EVENT_LOAD_TIMEOUT_MS because outboxes are a pre-step and
 * the report can fall back to LOOKUP_RELAYS.
 */
export const OUTBOX_LOAD_TIMEOUT_MS = 8_000;

/**
 * How long to wait for a single relay subscription request (e.g. per-relay
 * REQ for metadata events, or NIP-11 information document fetch).
 */
export const RELAY_REQUEST_TIMEOUT_MS = 8_000;

/**
 * How long to wait for all per-relay verdicts (online/offline checks via
 * NIP-66 monitors) before treating remaining unknowns as skippable.
 * Applied as a React-layer `setTimeout` in report components.
 */
export const VERDICT_TIMEOUT_MS = 15_000;

/**
 * The Maximum time to wait for the entire loader to complete.
 */
export const LOADER_TIMEOUT_MS = 30_000;

/**
 * Hard cap on the full broadcast operation. If publishing all metadata events
 * to all relays has not completed within this window, the report advances
 * automatically.
 */
export const BROADCAST_TIMEOUT_MS = 25_000;

/**
 * Delay before auto-advancing to the next report after an all-clear result
 * or a successful publish. Gives the user enough time to read what was checked
 * and why it matters before moving on.
 */
export const AUTO_ADVANCE_MS = 3_000;
