import type { User } from "applesauce-common/casts";
import { defined } from "applesauce-core";
import { merge, switchMap } from "rxjs";
import { eventLoader } from "../../lib/store";

/** Creates an observable that loads an addressable event from a users outboxes relays and the default relays */
export function loadAddressableEvent(
  user: User,
  kind: number,
  identifier?: string,
) {
  return merge(
    // Load from the users outboxes if found
    user.outboxes$.pipe(
      defined(),
      switchMap((outboxes) =>
        eventLoader({
          kind,
          pubkey: user.pubkey,
          relays: outboxes,
          identifier,
        }),
      ),
    ),
    // Load from default relays
    eventLoader({ kind, pubkey: user.pubkey, identifier }),
  );
}
