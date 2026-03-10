import { relaySet } from "applesauce-core/helpers";
import { RelayPool } from "applesauce-relay";

export const DEFAULT_RELAYS = relaySet([
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.ditto.pub",
]);

/** Default relay used for the remote signer (NIP-46) QR code on the sign-in page. */
export const DEFAULT_REMOTE_SIGNER_RELAY = "wss://relay.nsec.app/";

export const LOOKUP_RELAYS = relaySet([
  "wss://purplepag.es",
  "wss://index.hzrd149.com",
  "wss://indexer.coracle.social",
]);

export const pool = new RelayPool();
