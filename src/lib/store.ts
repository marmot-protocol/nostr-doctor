import { EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { DEFAULT_RELAYS, LOOKUP_RELAYS, pool } from "./relay";

export const eventStore = new EventStore();

export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  // Setup lookup relays to find users profiles and relay lists
  lookupRelays: LOOKUP_RELAYS,
  // Add extra relays for redundancy
  extraRelays: DEFAULT_RELAYS,
});
