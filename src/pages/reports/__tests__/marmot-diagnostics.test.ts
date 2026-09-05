/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { getEventHash, type NostrEvent } from "applesauce-core/helpers/event";
import {
  collapseCurrentReplacements,
  CURRENT_KEY_PACKAGE_KIND,
  DELETE_EVENT_KIND,
  LEGACY_KEY_PACKAGE_KIND,
  summarizeCurrentPackages,
  summarizeLegacyPackages,
  type RelayFetch,
} from "../marmot-diagnostics.ts";

const PUBKEY = "a".repeat(64);
const RELAY_A = "wss://a.example";
const RELAY_B = "wss://b.example";

function event(
  kind: number,
  createdAt: number,
  tags: string[][] = [],
  content = "AQIDBA==",
  pubkey = PUBKEY,
): NostrEvent {
  const unsigned = { kind, created_at: createdAt, tags, content, pubkey };
  return {
    ...unsigned,
    id: getEventHash(unsigned),
    sig: "0".repeat(128),
  };
}

function current(
  slot: string,
  createdAt: number,
  extraTags: string[][] = [],
  content = "AQIDBA==",
): NostrEvent {
  return event(
    CURRENT_KEY_PACKAGE_KIND,
    createdAt,
    [
      ["d", slot],
      ["mls_protocol_version", "1.0"],
      ["mls_ciphersuite", "0x0001"],
      ["mls_extensions", "0xf2ee"],
      ["relays", RELAY_A, RELAY_B],
      ["encoding", "base64"],
      ...extraTags,
    ],
    content,
  );
}

function fetch(relayUrl: string, events: NostrEvent[]): RelayFetch {
  return { relayUrl, events, error: false };
}

describe("current Marmot diagnostics", () => {
  it("reports a current-only kind 30443 fixture without calling the slot an authenticated device", () => {
    const packageEvent = current("desktop-slot", 100);
    const result = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent]), fetch(RELAY_B, [packageEvent])],
      [RELAY_A, RELAY_B],
      PUBKEY,
      200,
    );

    expect(result).toHaveLength(1);
    expect(result[0].publicationSlot).toBe("desktop-slot");
    expect(result[0].status).toBe("unvalidated-mls");
    expect(result[0].detail).toContain("no maintained shared parser");
  });

  it("collapses revisions by pubkey/kind/d and keeps distinct publication slots", () => {
    const oldA = current("slot-a", 100);
    const newA = current("slot-a", 200, [["client", "new"]]);
    const slotB = current("slot-b", 150);

    const result = collapseCurrentReplacements([oldA, slotB, newA]);

    expect(result.map((item) => item.id)).toEqual([newA.id, slotB.id]);
  });

  it("uses the lower event id as the Nostr tie-breaker", () => {
    const first = current("slot", 100, [["client", "first"]]);
    const second = current("slot", 100, [["client", "second"]]);
    const expected = [first, second].sort((a, b) =>
      a.id.localeCompare(b.id),
    )[0];

    expect(collapseCurrentReplacements([first, second])).toEqual([expected]);
    expect(collapseCurrentReplacements([second, first])).toEqual([expected]);
  });

  it("distinguishes valid-author kind 5 deletion by address", () => {
    const packageEvent = current("slot-a", 100);
    const deletion = event(DELETE_EVENT_KIND, 110, [
      ["a", `${CURRENT_KEY_PACKAGE_KIND}:${PUBKEY}:slot-a`],
    ]);

    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent, deletion])],
      [RELAY_A],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("deleted");
  });

  it("distinguishes NIP-40 expiry", () => {
    const packageEvent = current("slot-a", 100, [["expiration", "150"]]);
    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent])],
      [RELAY_A],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("expired");
  });

  it("distinguishes malformed current metadata", () => {
    const malformed = event(
      CURRENT_KEY_PACKAGE_KIND,
      100,
      [
        ["d", "slot-a"],
        ["encoding", "base64"],
      ],
      "not base64!",
    );
    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [malformed])],
      [RELAY_A],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("malformed");
  });

  it("distinguishes unsupported MLS declarations", () => {
    const unsupported = event(CURRENT_KEY_PACKAGE_KIND, 100, [
      ["d", "slot-a"],
      ["mls_protocol_version", "2.0"],
      ["mls_ciphersuite", "0x0001"],
      ["mls_extensions", "0xf2ee"],
      ["relays", RELAY_A],
      ["encoding", "base64"],
    ]);

    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [unsupported])],
      [RELAY_A],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("unsupported-mls");
  });

  it("distinguishes a package missing from an expected relay", () => {
    const packageEvent = current("slot-a", 100);
    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent]), fetch(RELAY_B, [])],
      [RELAY_A, RELAY_B],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("partial-relay");
    expect(result.missingFromRelays).toEqual([RELAY_B]);
  });
});

describe("legacy and mixed Marmot diagnostics", () => {
  it("keeps legacy kind 443 events in a separate legacy result", () => {
    const legacy = event(LEGACY_KEY_PACKAGE_KIND, 50, [
      ["device", "candidate"],
    ]);
    const result = summarizeLegacyPackages([fetch(RELAY_A, [legacy])]);

    expect(result).toHaveLength(1);
    expect(result[0].deviceCandidate).toBe("candidate");
  });

  it("does not mix legacy events into current publication slots", () => {
    const modern = current("slot-a", 100);
    const legacy = event(LEGACY_KEY_PACKAGE_KIND, 50, [["d", "legacy-slot"]]);
    const fetches = [fetch(RELAY_A, [modern, legacy])];

    expect(
      summarizeCurrentPackages(fetches, [RELAY_A], PUBKEY, 200),
    ).toHaveLength(1);
    expect(summarizeLegacyPackages(fetches)).toHaveLength(1);
  });
});
