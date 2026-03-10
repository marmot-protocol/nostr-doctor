import { RelayMonitor } from "applesauce-common/casts";
import { RELAY_MONITOR_ANNOUNCEMENT_KIND } from "applesauce-common/helpers";
import { castEventStream } from "applesauce-common/observable";
import { mapEventsToStore, simpleTimeout } from "applesauce-core/observable";
import {
  catchError,
  combineLatest,
  firstValueFrom,
  map,
  of,
  shareReplay,
  startWith,
} from "rxjs";
import { eventLoader, eventStore } from "./store.ts";

/** The canonical NIP-66 relay that publishes kind:10166 monitor announcements. */
export const MONITOR_RELAYS = ["wss://relay.nostr.watch/"];

/** Hard-coded allowlist of trusted NIP-66 monitor pubkeys */
export const APPROVED_MONITOR_PUBKEYS: ReadonlyArray<string> = [
  // nostr.watch monitor cluster
  "9bac3d58ef5a34c7c4a9b05b07c98e4afc56655542387b4d36c9d270f898592e", // Gilgeori Toast (KR)
  "9bbbb845e5b6c831c29789900769843ab43bb5047abe697870cb50b6fc9bf923", // Broodje Zeedijk (NL)
  "9b85d54cc4bc886d60782f80d676e41bc637ed3ecc73d2bb5aabadc499d6a340", // Kota (ZA)
  "9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b", // Chopped Cheese (US-EAST)
  "9ba046db56b8e6682c48af8d6425ffe80430a3cd0854d95381af27c5d27ca0f7", // Conti Roll (AU)
  // independent monitors
  "45df0580711f37c547270480d7aed2c7fc03ba5a4f8fef5a8787db0b19343de0", // Ghost
];

/** Timeout in milliseconds to wait for EOSE before giving up. */
const FETCH_TIMEOUT_MS = 5_000;

/** Observable of all approved monitors */
export const monitors$ = combineLatest(
  APPROVED_MONITOR_PUBKEYS.map((pubkey) =>
    eventLoader({
      kind: RELAY_MONITOR_ANNOUNCEMENT_KIND,
      pubkey,
      relays: MONITOR_RELAYS,
    }).pipe(
      simpleTimeout(FETCH_TIMEOUT_MS),
      // Save to event store
      mapEventsToStore(eventStore),
      // Cast events to RelayMonitor
      castEventStream(RelayMonitor, eventStore),
      // Return null for errors
      catchError(() => of(null)),
      // Start empty
      startWith(null),
    ),
  ),
).pipe(
  // Filter out null values
  map((monitors) => monitors.filter((m) => m !== null && m !== undefined)),
  // Cache list of monitors
  shareReplay(1),
);

/** Load a single relay monitor by pubkey */
export async function getMonitor(
  pubkey: string,
): Promise<RelayMonitor | undefined> {
  return firstValueFrom(
    eventLoader({
      kind: RELAY_MONITOR_ANNOUNCEMENT_KIND,
      pubkey,
      relays: MONITOR_RELAYS,
    }).pipe(
      simpleTimeout(FETCH_TIMEOUT_MS),
      mapEventsToStore(eventStore),
      castEventStream(RelayMonitor, eventStore),
      catchError(() => of(undefined)),
    ),
  );
}
