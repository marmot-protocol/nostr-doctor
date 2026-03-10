import { EventFactory } from "applesauce-core/event-factory";
import { manager } from "./accounts.ts";

// manager.signer is a ProxySigner that always points to the currently active account
export const factory = new EventFactory({
  signer: manager.signer,
  client: {
    name: "Dr. Nostr",
  },
});
