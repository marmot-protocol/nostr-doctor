import { RelayPool } from "applesauce-relay";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

export const LOOKUP_RELAYS = [
  "wss://purplepag.es",
  "wss://index.hzrd149.com",
  "wss://indexer.coracle.social",
];

export const pool = new RelayPool();
