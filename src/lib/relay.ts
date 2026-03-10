import { RelayPool } from "applesauce-relay";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

/** Default relay used for the remote signer (NIP-46) QR code on the sign-in page. */
export const DEFAULT_RELAY_FOR_REMOTE_SIGNER_QR = "wss://relay.nsec.app/";

export const LOOKUP_RELAYS = [
  "wss://purplepag.es",
  "wss://index.hzrd149.com",
  "wss://indexer.coracle.social",
];

export const pool = new RelayPool();
