/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { firstValueFrom } from "rxjs";
import { probeRelayAuth } from "../probe-relay-auth.ts";

// Any valid 32-byte hex pubkey works for the auth probe.
const TEST_PUBKEY = "f".repeat(64);

describe("probeRelayAuth (live relays)", () => {
  it("reports nip17.com as protected for gift-wrap reads", async () => {
    const result = await firstValueFrom(
      probeRelayAuth("wss://nip17.com", TEST_PUBKEY),
    );

    expect(result).toBe("protected");
  }, 20_000);

  it("reports nostr.land as protected for gift-wrap reads", async () => {
    const result = await firstValueFrom(
      probeRelayAuth("wss://nostr.land", TEST_PUBKEY),
    );

    expect(result).toBe("protected");
  }, 20_000);

  it("reports relay.damus.io as unprotected for gift-wrap reads", async () => {
    const result = await firstValueFrom(
      probeRelayAuth("wss://relay.damus.io", TEST_PUBKEY),
    );

    expect(result).toBe("unprotected");
  }, 20_000);
});
