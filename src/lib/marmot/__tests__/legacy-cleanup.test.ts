import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { buildLegacyCleanup } from "../legacy-cleanup.ts";
import {
  deletionRelayHints,
  publishReportEvent,
} from "../../deletion-relays.ts";

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("../../relay.ts", () => ({
  LOOKUP_RELAYS: [],
  DEFAULT_RELAYS: ["wss://default.example/"],
  pool: { publish: mocks.publish },
}));
const secret = new Uint8Array(32).fill(2);
const factory = new EventFactory();
async function signed(kind: number, created_at = 1) {
  return finalizeEvent(
    await factory.build({ kind, created_at, content: "legacy", tags: [] }),
    secret,
  );
}
beforeEach(() => {
  mocks.publish.mockReset();
});

describe("legacy cleanup requests", () => {
  it("targets every observed legacy id with kind tags and source relay hints", async () => {
    const packageEvent = await signed(443);
    const list = await signed(10051);
    const entries = [
      {
        event: packageEvent,
        foundOnRelays: ["wss://old-a.example/", "wss://old-b.example/"],
      },
      { event: list, foundOnRelays: ["wss://old-a.example/"] },
    ];
    const requests = await buildLegacyCleanup(entries, packageEvent.pubkey);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.kind).toBe(5);
      expect(request.tags.some((tag) => tag[0] === "a")).toBe(false);
      expect(
        request.tags
          .filter((tag) => tag[0] === "e")
          .every((tag) => [packageEvent.id, list.id].includes(tag[1])),
      ).toBe(true);
      expect(
        deletionRelayHints(JSON.parse(JSON.stringify(request))),
      ).toHaveLength(1);
    }
    const first = requests.find((request) =>
      deletionRelayHints(request).includes("wss://old-a.example/"),
    )!;
    expect(
      first.tags
        .filter((tag) => tag[0] === "e")
        .map((tag) => tag[1])
        .sort(),
    ).toEqual([packageEvent.id, list.id].sort());
    expect(
      first.tags
        .filter((tag) => tag[0] === "k")
        .map((tag) => tag[1])
        .sort(),
    ).toEqual(["10051", "443"]);
  });
  it.each([10050, 1050, 30443, 1059, 5])(
    "never builds a cleanup request for kind %i",
    async (kind) => {
      const event = await signed(kind);
      await expect(
        buildLegacyCleanup(
          [{ event, foundOnRelays: ["wss://old.example/"] }],
          event.pubkey,
        ),
      ).rejects.toThrow("signed legacy Marmot events");
    },
  );
  it("refuses forged events, another author's events, and missing source relays", async () => {
    const event = await signed(443);
    await expect(
      buildLegacyCleanup(
        [
          {
            event: { ...event, sig: "0".repeat(128) },
            foundOnRelays: ["wss://old.example/"],
          },
        ],
        event.pubkey,
      ),
    ).rejects.toThrow();
    await expect(
      buildLegacyCleanup(
        [{ event, foundOnRelays: ["wss://old.example/"] }],
        "f".repeat(64),
      ),
    ).rejects.toThrow();
    await expect(
      buildLegacyCleanup(
        [{ event, foundOnRelays: ["https://invalid.example"] }],
        event.pubkey,
      ),
    ).rejects.toThrow("source relay");
  });
  it("deduplicates copies and splits a large inventory into bounded requests", async () => {
    const events = await Promise.all(
      Array.from({ length: 101 }, (_, index) => signed(443, index)),
    );
    const entries = events.map((event) => ({
      event,
      foundOnRelays: ["wss://old.example/"],
    }));
    const requests = await buildLegacyCleanup(
      [...entries, entries[0]],
      events[0].pubkey,
    );
    expect(
      requests
        .map((request) => request.tags.filter((tag) => tag[0] === "e").length)
        .sort((a, b) => a - b),
    ).toEqual([1, 100]);
  });
  it("routes serialized drafts to old source relays and detects rejected acknowledgements", async () => {
    const event = await signed(443);
    const [draft] = await buildLegacyCleanup(
      [{ event, foundOnRelays: ["wss://old.example/"] }],
      event.pubkey,
    );
    const request = finalizeEvent(JSON.parse(JSON.stringify(draft)), secret);
    mocks.publish.mockResolvedValue([{ from: "wss://old.example/", ok: true }]);
    await publishReportEvent(request, ["wss://outbox.example/"]);
    expect(mocks.publish.mock.calls[0][0].sort()).toEqual(
      [
        "wss://default.example/",
        "wss://old.example/",
        "wss://outbox.example/",
      ].sort(),
    );
    mocks.publish.mockResolvedValue([
      { from: "wss://default.example/", ok: true },
      { from: "wss://old.example/", ok: false },
    ]);
    await expect(publishReportEvent(request)).rejects.toThrow(
      "wss://old.example/",
    );
    mocks.publish.mockResolvedValue([]);
    await expect(publishReportEvent(request)).rejects.toThrow(
      "not acknowledged",
    );
  });
  it("ignores invalid hints and does not use event references on other kinds as publish destinations", async () => {
    const event = await signed(1);
    expect(
      deletionRelayHints({
        ...event,
        tags: [["e", event.id, "wss://old.example/"]],
      }),
    ).toEqual([]);
    expect(
      deletionRelayHints({
        ...event,
        kind: 5,
        tags: [
          ["e", event.id, "https://invalid.example"],
          ["e", "bad-id", "wss://old.example/"],
        ],
      }),
    ).toEqual([]);
  });
});
