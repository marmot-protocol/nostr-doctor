import {
  verifyEvent,
  verifiedSymbol,
  type NostrEvent,
} from "applesauce-core/helpers";

/** Ignore cached/fake verification marks used by read-only draft previews. */
export function verifySignedEvent(event: NostrEvent): boolean {
  const copy = { ...event };
  delete copy[verifiedSymbol];
  return verifyEvent(copy);
}
