import { BehaviorSubject } from "rxjs";
import type { NostrEvent } from "applesauce-core/helpers";

/**
 * Pending events collected during the report flow (read-only mode) or loaded
 * from a referral pack. Keyed by event UID so replaceable events (kind:0,
 * kind:10002, etc.) are automatically deduplicated — a later fix for the same
 * kind always overwrites the earlier one.
 *
 * Use getEventUID() from applesauce-core/helpers to derive the key:
 *   - Regular/ephemeral:           event.id
 *   - Replaceable (0, 3, 10000–): "kind:pubkey:"
 *   - Parameterized addressable:   "kind:pubkey:d-tag"
 *
 * Cleared after events are published or the user starts over.
 */
export const draftEvents$ = new BehaviorSubject<Record<string, NostrEvent>>({});
