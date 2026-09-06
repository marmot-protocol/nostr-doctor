import { describe, expect, it } from "vitest";
import { getEventHash, type NostrEvent } from "applesauce-core/helpers/event";
import {
  collapseCurrentReplacements,
  deletionTargetsEvent,
  readRelayList,
  isMarmotRelayUrl,
  CURRENT_KEY_PACKAGE_KIND,
  DELETE_EVENT_KIND,
  LEGACY_KEY_PACKAGE_KIND,
  summarizeCurrentPackages,
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
      ["i", "1".repeat(64)],
      ["mls_extensions", "0x0006"],
      ["mls_proposals", "0x0008"],
      ["app_components", "0x8009"],
      ...extraTags,
    ],
    content,
  );
}

function fetch(relayUrl: string, events: NostrEvent[]): RelayFetch {
  return { relayUrl, events, error: false, complete: true };
}

describe("current Marmot diagnostics", () => {
  it("reports a current-only kind 30443 fixture without calling the slot an authenticated device", () => {
    const packageEvent = current(
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      100,
    );
    const result = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent]), fetch(RELAY_B, [packageEvent])],
      [RELAY_A, RELAY_B],
      PUBKEY,
      200,
    );

    expect(result).toHaveLength(1);
    expect(result[0].publicationSlot).toBe(
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    );
    expect(result[0].status).toBe("unvalidated-mls");
    expect(result[0].detail).toContain("validation has not completed");
  });

  it("collapses revisions by pubkey/kind/d and keeps distinct publication slots", () => {
    const oldA = current(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      100,
    );
    const newA = current(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      200,
      [["client", "new"]],
    );
    const slotB = current(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      150,
    );

    const result = collapseCurrentReplacements([oldA, slotB, newA]);

    expect(result.map((item) => item.id)).toEqual([newA.id, slotB.id]);
  });

  it("uses the lower event id as the Nostr tie-breaker", () => {
    const first = current(
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      100,
      [["client", "first"]],
    );
    const second = current(
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      100,
      [["client", "second"]],
    );
    const expected = [first, second].sort((a, b) =>
      a.id.localeCompare(b.id),
    )[0];

    expect(collapseCurrentReplacements([first, second])).toEqual([expected]);
    expect(collapseCurrentReplacements([second, first])).toEqual([expected]);
  });

  it("distinguishes valid-author kind 5 deletion by address", () => {
    const packageEvent = current(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      100,
    );
    const deletion = event(DELETE_EVENT_KIND, 110, [
      ["a", `${CURRENT_KEY_PACKAGE_KIND}:${PUBKEY}:${"a".repeat(64)}`],
    ]);

    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent, deletion])],
      [RELAY_A],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("deletion-requested");
  });

  it("distinguishes NIP-40 expiry", () => {
    const packageEvent = current(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      100,
      [["expiration", "150"]],
    );
    const [result] = summarizeCurrentPackages(
      [fetch(RELAY_A, [packageEvent])],
      [RELAY_A],
      PUBKEY,
      200,
    );

    expect(result.status).toBe("relay-expired");
  });

  it("distinguishes malformed current metadata", () => {
    const malformed = event(
      CURRENT_KEY_PACKAGE_KIND,
      100,
      [
        [
          "d",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ],
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
      ["d", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      ["mls_protocol_version", "2.0"],
      ["mls_ciphersuite", "0x0001"],
      ["i", "1".repeat(64)],
      ["mls_extensions", "0x0006"],
      ["mls_proposals", "0x0008"],
      ["app_components", "0x8009"],
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
    const packageEvent = current(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      100,
    );
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
  it("does not mix legacy events into current publication slots", () => {
    const modern = current(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      100,
    );
    const legacy = event(LEGACY_KEY_PACKAGE_KIND, 50, [["d", "legacy-slot"]]);
    const fetches = [fetch(RELAY_A, [modern, legacy])];

    expect(
      summarizeCurrentPackages(fetches, [RELAY_A], PUBKEY, 200),
    ).toHaveLength(1);
  });
});

describe("current transport metadata", () => {
  function status(tags: string[][], content = "AQIDBA==") {
    const candidate = event(CURRENT_KEY_PACKAGE_KIND, 100, tags, content);
    return summarizeCurrentPackages(
      [fetch(RELAY_A, [candidate])],
      [RELAY_A],
      PUBKEY,
      200,
    )[0].status;
  }
  const tags = current("a".repeat(64), 100).tags;

  it.each([
    "d",
    "i",
    "mls_protocol_version",
    "mls_ciphersuite",
    "mls_extensions",
    "mls_proposals",
    "app_components",
  ])("requires exactly one %s tag", (name) => {
    expect(status(tags.filter((tag) => tag[0] !== name))).toBe("malformed");
    expect(status([...tags, tags.find((tag) => tag[0] === name)!])).toBe(
      "malformed",
    );
  });
  it.each([
    ["d", "device-name"],
    ["d", "A".repeat(64)],
    ["i", "xyz"],
    ["mls_extensions"],
    ["mls_extensions", "0x6"],
    ["mls_extensions", "0x0006", "0x0006"],
    ["mls_proposals", "0x000A"],
    ["app_components", "0x8001"],
    ["mls_protocol_version", "1.0", "extra"],
  ])("rejects malformed tag %j", (...replacement) => {
    expect(
      status(
        tags.map((tag) => (tag[0] === replacement[0] ? replacement : tag)),
      ),
    ).toBe("malformed");
  });
  it("rejects legacy encoding and relay tags", () => {
    expect(status([...tags, ["encoding", "base64"]])).toBe("malformed");
    expect(status([...tags, ["relays", RELAY_A]])).toBe("malformed");
  });
  it.each(["AQIDBA", "AQIDBB==", "not base64!"])(
    "rejects noncanonical base64 %s",
    (content) => {
      expect(status(tags, content)).toBe("malformed");
    },
  );
  it("checks the whole ciphersuite id-list", () => {
    expect(
      status(
        tags.map((tag) =>
          tag[0] === "mls_ciphersuite"
            ? ["mls_ciphersuite", "0x0002", "0x0001"]
            : tag,
        ),
      ),
    ).toBe("unvalidated-mls");
  });
  it("allows additional ciphersuites without asserting group compatibility", () => {
    expect(
      status(
        tags.map((tag) =>
          tag[0] === "mls_ciphersuite" ? ["mls_ciphersuite", "0x0002"] : tag,
        ),
      ),
    ).toBe("unvalidated-mls");
  });
  it("does not call a failed or unfinished relay missing", () => {
    const candidate = current("a".repeat(64), 100);
    for (const second of [
      { relayUrl: RELAY_B, events: [], error: true, complete: true },
      { relayUrl: RELAY_B, events: [], error: false, complete: false },
    ]) {
      const [result] = summarizeCurrentPackages(
        [fetch(RELAY_A, [candidate]), second],
        [RELAY_A, RELAY_B],
        PUBKEY,
        200,
      );
      expect(result.status).toBe("relay-unverified");
      expect(result.missingFromRelays).toEqual([]);
      expect(result.uncheckedRelays).toEqual([RELAY_B]);
    }
  });
});

describe("relay roles and deletion semantics", () => {
  it("uses only write and unmarked NIP-65 entries", () => {
    const list = event(10002, 100, [
      ["r", RELAY_A],
      ["r", RELAY_B, "write"],
      ["r", "wss://read.example", "read"],
    ]);
    expect(readRelayList(list).urls).toEqual([RELAY_A, RELAY_B]);
  });
  it("reads inbox URLs from relay tags, not NIP-65 r tags", () => {
    const list = event(10050, 100, [
      ["relay", RELAY_A],
      ["r", RELAY_B],
    ]);
    expect(readRelayList(list).urls).toEqual([RELAY_A]);
  });
  it.each([
    "https://example.com",
    "wss://user:password@example.com",
    "wss://example.com/#private",
    "wss://example.com/#",
    "wss://",
    "wss://example.com/" + "a".repeat(512),
    "wss://example.com/\n",
    "wss://example.com/\ud800",
    "wss://example.com\\path",
  ])("rejects invalid relay URL %s", (url) => {
    expect(isMarmotRelayUrl(url)).toBe(false);
    expect(
      readRelayList(event(10050, 100, [["relay", url]])).invalidUrls,
    ).toEqual([url]);
  });
  it("preserves signed URL bytes before connection normalization", () => {
    const url = "wss://EXAMPLE.com:443/path//to";
    expect(readRelayList(event(10050, 100, [["relay", url]])).urls).toEqual([
      url,
    ]);
  });
  it("applies the timestamp bound only to address deletions", () => {
    const candidate = current("a".repeat(64), 100);
    expect(
      deletionTargetsEvent(event(5, 90, [["e", candidate.id]]), candidate),
    ).toBe(true);
    expect(
      deletionTargetsEvent(
        event(5, 90, [["a", `30443:${PUBKEY}:${"a".repeat(64)}`]]),
        candidate,
      ),
    ).toBe(false);
    expect(
      deletionTargetsEvent(
        event(5, 100, [["a", `30443:${PUBKEY}:${"a".repeat(64)}`]]),
        candidate,
      ),
    ).toBe(true);
    expect(
      deletionTargetsEvent(
        event(5, 110, [["e", candidate.id]], "", "f".repeat(64)),
        candidate,
      ),
    ).toBe(false);
  });
});
