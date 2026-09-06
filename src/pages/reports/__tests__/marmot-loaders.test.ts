import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BehaviorSubject,
  map,
  filter,
  throwError,
  NEVER,
  of,
  Subject,
  takeUntil,
  timer,
  type Observable,
} from "rxjs";
import type { User } from "applesauce-common/casts";
import {
  finalizeEvent,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toLoaderState } from "../../../observable/operator/to-loader-state.ts";
import type { LoaderState } from "../loader-types.ts";
import {
  createLoader as packagesLoader,
  type KeyPackagesState,
} from "../key-packages/loader.ts";
import {
  createLoader as relaysLoader,
  type KeyPackageRelayListState,
} from "../key-package-relays/loader.ts";
import { ReqCloseError } from "applesauce-relay";
import { requestRelayEvents, discoverRelayList } from "../marmot-loaders.ts";
import { keyPackageOutcome, marmotRelayOutcome } from "../marmot-outcomes.ts";
import { hasUnresolvedChecks } from "../../../lib/sectionOutcomes.ts";
import RelayReport from "../key-package-relays/page.tsx";
import LegacyCleanupReport from "../marmot-legacy-cleanup/page.tsx";
import { createLoader as cleanupLoader } from "../marmot-legacy-cleanup/loader.ts";
import {
  CURRENT_INBOX_RELAYS_KIND,
  CURRENT_KEY_PACKAGE_KIND,
  GIFT_WRAP_KIND,
} from "../marmot-diagnostics.ts";
import {
  EVENT_LOAD_TIMEOUT_MS,
  LOADER_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";

const mocks = vi.hoisted(() => ({
  relay: vi.fn(),
  list: vi.fn(),
  verdict: vi.fn(),
  rawList: vi.fn(),
}));
vi.mock("../../../lib/relay.ts", () => ({
  LOOKUP_RELAYS: ["wss://lookup.example/"],
  pool: { relay: mocks.relay },
}));
vi.mock("../../../lib/relay-monitors.ts", () => ({
  relayVerdict: mocks.verdict,
}));
vi.mock("../../../lib/store.ts", () => ({ eventLoader: mocks.rawList }));

const LOOKUP = "wss://lookup.example/";
const OUTBOX = "wss://outbox.example/";
const INBOX = "wss://inbox.example/";
const TEST_SECRET = new Uint8Array(32).fill(1);
function signed(
  kind: number,
  tags: string[][],
  created_at = 100,
  content = "",
) {
  return finalizeEvent({ kind, tags, created_at, content }, TEST_SECRET);
}
const PUBKEY = signed(0, []).pubkey;
// MLS parsing is explicitly unvalidated; this fixture exercises transport fetching.
const candidate = signed(
  CURRENT_KEY_PACKAGE_KIND,
  [
    ["d", "c".repeat(64)],
    ["i", "d".repeat(64)],
    ["mls_protocol_version", "1.0"],
    ["mls_ciphersuite", "0x0001"],
    ["mls_extensions", "0x0006"],
    ["mls_proposals", "0x0008"],
    ["app_components", "0x8009"],
  ],
  100,
  "AQIDBA==",
);

function subject(outboxes$: Observable<string[] | undefined | null>) {
  return { pubkey: PUBKEY, outboxes$ } as User;
}
function collect<T>(source: Observable<T>) {
  const values: LoaderState<T>[] = [];
  source
    .pipe(takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)), toLoaderState())
    .subscribe((state) => values.push(state));
  return values;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.list.mockReturnValue(NEVER);
  mocks.rawList.mockImplementation(
    ({
      kind,
      pubkey,
      relays,
    }: {
      kind: number;
      pubkey: string;
      relays: string[];
    }) => {
      if (kind === 10002)
        return of(
          signed(
            kind,
            relays.includes(OUTBOX) ? [["r", OUTBOX, "write"]] : [],
            relays.includes(OUTBOX) ? 200 : 100,
          ),
        );
      return mocks.list(kind, pubkey, relays).pipe(
        filter((urls: string[] | null) => urls !== null),
        map((urls: string[]) =>
          signed(
            kind,
            urls.map((url) => ["relay", url]),
          ),
        ),
      );
    },
  );
  mocks.verdict.mockReturnValue(NEVER);
  mocks.relay.mockImplementation((url: string) => ({
    url,
    authRequiredForRead$: of(false),
    supported$: NEVER,
    request: () => NEVER,
  }));
});
afterEach(() => {
  vi.advanceTimersByTime(LOADER_TIMEOUT_MS * 2);
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Marmot streaming loaders", () => {
  it("never fetches legacy kinds during current readiness checks", () => {
    const request = vi.fn(() => of());
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      supported$: of([9]),
      request,
    }));
    collect(packagesLoader(subject(of([OUTBOX]))));
    collect(relaysLoader(subject(of([OUTBOX]))));
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    expect(request.mock.calls.length).toBeGreaterThan(0);
    for (const [filter] of request.mock.calls as unknown as [Filter][]) {
      expect(filter.kinds).not.toContain(443);
      expect(filter.kinds).not.toContain(10051);
    }
    expect(
      mocks.rawList.mock.calls.every(([args]) => args.kind !== 10051),
    ).toBe(true);
  });
  it("searches lookup relays immediately without NIP-65 or legacy metadata", () => {
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      supported$: NEVER,
      request: (filter: Filter) =>
        filter.kinds?.includes(CURRENT_KEY_PACKAGE_KIND)
          ? of(candidate)
          : NEVER,
    }));
    const values = collect(
      packagesLoader(subject(new BehaviorSubject(undefined))),
    );
    expect(values.at(-1)?.data.currentPackages[0].id).toBe(candidate.id);
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    expect(values.at(-1)?.complete).toBe(true);
    expect(values.at(-1)?.data.currentPackages[0].id).toBe(candidate.id);
    expect(values.at(-1)?.data.nip65WriteRelays).toEqual([]);
  });

  it("preserves events before EOSE and while adding late outboxes", () => {
    const outboxes = new BehaviorSubject<string[] | undefined>(undefined);
    const events = new Subject<NostrEvent>();
    let lookupRequests = 0;
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      supported$: NEVER,
      request: (filter: Filter) => {
        if (
          url === LOOKUP &&
          filter.kinds?.includes(CURRENT_KEY_PACKAGE_KIND)
        ) {
          lookupRequests++;
          return events;
        }
        return NEVER;
      },
    }));
    const values = collect(packagesLoader(subject(outboxes)));
    events.next(candidate);
    expect(values.at(-1)?.data.currentPackages).toHaveLength(1);
    outboxes.next([OUTBOX]);
    expect(values.at(-1)?.data.currentPackages).toHaveLength(1);
    expect(lookupRequests).toBe(1);
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    const final = values.at(-1)!;
    expect(final.complete).toBe(true);
    expect(final.data.currentPackages[0].uncheckedRelays).toEqual([OUTBOX]);
    expect(final.data.currentPackages[0].missingFromRelays).toEqual([]);
    expect(final.data.incompleteRelays).toContain(LOOKUP);
  });

  it("preserves fetched events on a subsequent relay error", () => {
    const events = new Subject<NostrEvent>();
    mocks.relay.mockReturnValue({
      authRequiredForRead$: of(false),
      supported$: NEVER,
      request: () => events,
    });
    const values = collect(packagesLoader(subject(of([LOOKUP]))));
    events.next(candidate);
    events.error(new Error("disconnected"));
    expect(values.at(-1)?.data.currentPackages[0].id).toBe(candidate.id);
    expect(values.at(-1)?.data.incompleteRelays).toContain(LOOKUP);
  });

  it("keeps discovered inboxes and live verdicts before the 10-second deadline", () => {
    const verdict = new BehaviorSubject("online");
    mocks.verdict.mockReturnValue(verdict); // Does not complete until after the page deadline.
    mocks.list.mockImplementation((kind: number) =>
      kind === CURRENT_INBOX_RELAYS_KIND ? of([INBOX]) : NEVER,
    );
    const values = collect(relaysLoader(subject(of([OUTBOX]))));
    expect(values.at(-1)?.data.currentInboxRelayUrls).toEqual([INBOX]);
    expect(values.at(-1)?.data.currentRelays[INBOX].verdict).toBe("online");
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    expect(values.at(-1)?.complete).toBe(true);
    expect(values.at(-1)?.data.currentInboxRelayUrls).toEqual([INBOX]);
    expect(values.at(-1)?.data.currentRelays[INBOX].giftWrapRetrieval).toBe(
      "unknown",
    );
  });

  it("discovers inboxes when the account has no outbox list", () => {
    mocks.list.mockImplementation((kind: number) =>
      kind === CURRENT_INBOX_RELAYS_KIND ? of([INBOX]) : of(null),
    );
    const values = collect(relaysLoader(subject(new BehaviorSubject(null))));
    expect(values.at(-1)?.data.currentInboxRelayUrls).toEqual([INBOX]);
    expect(mocks.list).toHaveBeenCalledWith(CURRENT_INBOX_RELAYS_KIND, PUBKEY, [
      LOOKUP,
    ]);
  });

  it("replays completed loaders without repeating requests", () => {
    mocks.list.mockReturnValue(of(null));
    const request = vi.fn(() => of(candidate));
    mocks.relay.mockReturnValue({
      authRequiredForRead$: of(false),
      supported$: of([]),
      request,
    });
    const loader = packagesLoader(subject(of([LOOKUP])));
    const first: KeyPackagesState[] = [];
    loader.subscribe((state) => first.push(state));
    const count = request.mock.calls.length;
    const second: KeyPackagesState[] = [];
    loader.subscribe((state) => second.push(state));
    expect(second).toEqual([first.at(-1)]);
    expect(request).toHaveBeenCalledTimes(count);
  });
});

describe("dedicated legacy cleanup", () => {
  it("retains observed events when a late outbox moves a relay between discovery branches", () => {
    const old = "wss://old.example/";
    const list = signed(10051, [["relay", old]]);
    const legacy = signed(443, []);
    const nip65 = new Subject<NostrEvent>();
    mocks.rawList.mockReturnValue(nip65);
    let oldRequests = 0;
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      request: () => {
        if (url === LOOKUP) return of(list);
        if (url === old && ++oldRequests === 1) return of(legacy);
        return NEVER;
      },
    }));
    const values = collect(cleanupLoader(subject(of([]))));
    expect(
      values.at(-1)!.data.events.some(({ event }) => event.id === legacy.id),
    ).toBe(true);
    nip65.next(signed(10002, [["r", old, "write"]], 200));
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    expect(
      values.at(-1)!.data.events.some(({ event }) => event.id === legacy.id),
    ).toBe(true);
    expect(values.at(-1)!.data.incompleteRelays).toContain(old);
  });
  it("finds legacy events using both newer and older legacy lists without requesting current kinds", () => {
    const oldA = "wss://old-a.example/";
    const oldB = "wss://old-b.example/";
    const listA = signed(10051, [["relay", oldA]], 200);
    const listB = signed(10051, [["relay", oldB]], 100);
    const packageA = signed(443, [], 201);
    const packageB = signed(443, [], 101);
    const request = vi.fn((url: string, filter: Filter) => {
      expect(filter.kinds).toEqual([443, 10051]);
      expect(filter.authors).toEqual([PUBKEY]);
      if (url === LOOKUP) return of(listA);
      if (url === OUTBOX) return of(listB);
      if (url === oldA) return of(packageA);
      if (url === oldB) return of(packageB, packageA);
      return of();
    });
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      request: (filter: Filter) => request(url, filter),
    }));
    const values = collect(cleanupLoader(subject(of([OUTBOX]))));
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    const state = values.at(-1)!.data;
    expect(state.events.map(({ event }) => event.id).sort()).toEqual(
      [listA.id, listB.id, packageA.id, packageB.id].sort(),
    );
    expect(
      state.events
        .find(({ event }) => event.id === packageA.id)
        ?.foundOnRelays.sort(),
    ).toEqual([oldA, oldB]);
    expect(state.incompleteRelays).toEqual([]);
    expect(request.mock.calls.filter(([url]) => url === LOOKUP)).toHaveLength(
      1,
    );
    expect(mocks.verdict).not.toHaveBeenCalled();
  });
  it("keeps cleanup candidates from interrupted requests and excludes current or forged data", () => {
    const legacy = signed(443, []);
    const response = new Subject<NostrEvent>();
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      request: () => response,
    }));
    const values = collect(cleanupLoader(subject(of([]))));
    response.next(legacy);
    response.next(signed(10050, []));
    response.next(signed(30443, []));
    response.next({ ...legacy, sig: "0".repeat(128) });
    vi.advanceTimersByTime(EVENT_LOAD_TIMEOUT_MS);
    const state = values.at(-1)!.data;
    expect(state.events.map(({ event }) => event.id)).toEqual([legacy.id]);
    expect(state.incompleteRelays).toContain(LOOKUP);
    expect(values.at(-1)!.complete).toBe(true);
  });
  it("shows cleanup only as an optional action, with signed-out queueing and a first-frame Skip", () => {
    const props = {
      subject: subject(of([])),
      account: null,
      publish: async () => {},
      onDone: () => {},
      onContinue: () => {},
      isActive: true,
      isDoneSection: false,
    };
    const loading = renderToStaticMarkup(
      createElement(LegacyCleanupReport, { ...props, loaderState: undefined }),
    );
    expect(loading).toContain("Skip");
    const ready = renderToStaticMarkup(
      createElement(LegacyCleanupReport, {
        ...props,
        loaderState: {
          complete: true,
          data: {
            events: [{ event: signed(443, []), foundOnRelays: [LOOKUP] }],
            queriedRelays: [LOOKUP],
            incompleteRelays: [],
            invalidRelayUrls: [],
          },
        },
      }),
    );
    expect(ready).toContain("Queue deletion of all legacy data");
    expect(ready).toContain(
      "Current kind 30443 KeyPackages and kind 10050 inbox relays are kept",
    );
  });
});

describe("gift-wrap presentation", () => {
  it("does not identify an opaque gift wrap as a Marmot Welcome", () => {
    mocks.list.mockImplementation((kind: number) =>
      kind === CURRENT_INBOX_RELAYS_KIND ? of([INBOX]) : of(null),
    );
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      supported$: of([9]),
      request: () =>
        of(signed(GIFT_WRAP_KIND, [["p", PUBKEY]], 100, "encrypted")),
    }));
    const values = collect(relaysLoader(subject(of([]))));
    const state = values.at(-1)!.data;
    expect(state.currentRelays[INBOX].giftWrapRetrieval).toBe("observed");
    const html = renderRelayReport({ data: state, complete: true });
    expect(html).toContain("1 encrypted kind 1059 gift wrap(s) observed");
    expect(html).toContain("their encrypted contents are not inspected");
    expect(html).not.toContain("Welcome observed");
    expect(html).not.toContain(candidate.content);
  });

  it("shows Skip and partial inbox rows during loading", () => {
    const html = renderRelayReport({
      complete: false,
      data: {
        nip65WriteRelays: [],
        writeRelays: {},
        invalidWriteUrls: [],
        invalidInboxUrls: [],
        discoveryComplete: false,
        currentInboxRelayUrls: [INBOX],
        currentRelays: {},
      },
    });
    expect(html).toContain(INBOX);
    expect(html).toContain("Skip");
    expect(html).not.toContain("No current kind 10050 inbox relay list");
  });
});

function renderRelayReport(loaderState: LoaderState<KeyPackageRelayListState>) {
  return renderToStaticMarkup(
    createElement(RelayReport, {
      loaderState,
      subject: subject(of([])),
      account: null,
      publish: async () => {},
      onDone: () => {},
      onContinue: () => {},
      isActive: true,
      isDoneSection: false,
    }),
  );
}

describe("signed transport evidence and relay roles", () => {
  it("ignores forged packages, forged deletions and unrelated signed events", () => {
    const forged = JSON.parse(JSON.stringify(candidate)) as NostrEvent;
    forged.sig = "0".repeat(128);
    const deletion = signed(5, [["e", candidate.id]]);
    const forgedDeletion = {
      ...JSON.parse(JSON.stringify(deletion)),
      sig: "0".repeat(128),
    } as NostrEvent;
    const unrelated = signed(1, []);
    mocks.relay.mockReturnValue({
      authRequiredForRead$: of(false),
      request: () => of(forged, candidate, forgedDeletion, unrelated),
    });
    const values = collect(
      requestRelayEvents(LOOKUP, { kinds: [30443, 5], authors: [PUBKEY] }),
    );
    expect(values.at(-1)?.data.events.map((event) => event.id)).toEqual([
      candidate.id,
    ]);
    expect(values.at(-1)?.data.invalidEvents).toBe(3);
  });

  it("rejects another recipient's signed gift wraps", () => {
    mocks.relay.mockReturnValue({
      authRequiredForRead$: of(false),
      request: () => of(signed(1059, [["p", "f".repeat(64)]])),
    });
    const values = collect(
      requestRelayEvents(INBOX, { kinds: [1059], "#p": [PUBKEY] }),
    );
    expect(values.at(-1)?.data.events).toEqual([]);
    expect(values.at(-1)?.data.invalidEvents).toBe(1);
  });

  it("keeps the newest signed relay list when relays respond out of order", () => {
    const newer = signed(10050, [["relay", INBOX]], 200);
    const older = signed(10050, [["relay", LOOKUP]], 100);
    const forged = {
      ...JSON.parse(JSON.stringify(newer)),
      created_at: 300,
    } as NostrEvent;
    mocks.rawList.mockReturnValue(of(newer, older, forged));
    const values = collect(discoverRelayList(PUBKEY, 10050, of([LOOKUP])));
    expect(values.at(-1)?.data.event?.id).toBe(newer.id);
    expect(values.at(-1)?.data.urls).toEqual([INBOX]);
    expect(values.at(-1)?.data.complete).toBe(false);
    expect(values.at(-1)?.data.invalidEvents).toBe(1);
  });

  it("does not report an absent inbox when only a forged list was received", () => {
    const forged = {
      ...JSON.parse(JSON.stringify(signed(10050, [["relay", INBOX]]))),
      sig: "0".repeat(128),
    } as NostrEvent;
    mocks.rawList.mockImplementation(({ kind }: { kind: number }) =>
      kind === 10050 ? of(forged) : of(signed(kind, [])),
    );
    const state = collect(relaysLoader(subject(of([])))).at(-1)!.data;
    expect(state.currentInboxRelayUrls).toBeUndefined();
    expect(state.discoveryComplete).toBe(false);
    expect(marmotRelayOutcome(state).status).toBe("warning");
  });

  it("preserves a discovered list if the stream errors before EOSE", () => {
    const stream = new Subject<NostrEvent>();
    mocks.rawList.mockReturnValue(stream);
    const values = collect(discoverRelayList(PUBKEY, 10050, of([LOOKUP])));
    stream.next(signed(10050, [["relay", INBOX]]));
    stream.error(new Error("disconnected"));
    expect(values.at(-1)?.data.urls).toEqual([INBOX]);
    expect(values.at(-1)?.data.complete).toBe(false);
  });

  it("refreshes relay lists and treats empty loader completion as inconclusive", () => {
    mocks.rawList.mockReturnValue(of());
    const values = collect(discoverRelayList(PUBKEY, 10050, of([LOOKUP])));
    expect(mocks.rawList).toHaveBeenCalledWith({
      kind: 10050,
      pubkey: PUBKEY,
      relays: [LOOKUP],
      cache: false,
    });
    expect(values.at(-1)?.data.event).toBeNull();
    expect(values.at(-1)?.data.complete).toBe(false);
  });

  it("checks NIP-09 on write relays and treats protected inboxes as expected", () => {
    mocks.list.mockImplementation((kind: number) =>
      kind === 10050 ? of([INBOX]) : of(null),
    );
    mocks.verdict.mockReturnValue(of("online"));
    let inboxNip11Reads = 0;
    mocks.relay.mockImplementation((url: string) => ({
      url,
      authRequiredForRead$: of(false),
      get supported$() {
        if (url === INBOX) inboxNip11Reads++;
        return of(url === OUTBOX ? [9] : []);
      },
      request: () =>
        throwError(() => new ReqCloseError("auth-required: recipient only")),
    }));
    const values = collect(relaysLoader(subject(of([OUTBOX]))));
    const state = values.at(-1)!.data;
    expect(state.writeRelays[OUTBOX].deleteSupport).toBe("advertised");
    expect(state.currentRelays[INBOX].giftWrapRetrieval).toBe("auth-required");
    expect(inboxNip11Reads).toBe(0);
    expect(marmotRelayOutcome(state).status).toBe("clean");
    expect(renderRelayReport({ complete: true, data: state })).toContain(
      "not a delivery failure",
    );
  });

  it("does not wait on a previously observed authentication requirement", () => {
    const request = vi.fn(() => NEVER);
    mocks.relay.mockReturnValue({ authRequiredForRead$: of(true), request });
    const values = collect(
      requestRelayEvents(INBOX, { kinds: [1059], "#p": [PUBKEY] }),
    );
    expect(values.at(-1)?.data.authRequired).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not report missing NIP-11 advertisements as proven failure", () => {
    mocks.list.mockImplementation((kind: number) =>
      kind === 10050 ? of([INBOX]) : of(null),
    );
    mocks.verdict.mockReturnValue(of("online"));
    mocks.relay.mockReturnValue({
      authRequiredForRead$: of(false),
      supported$: of([]),
      request: () => of(),
    });
    const state = collect(relaysLoader(subject(of([OUTBOX])))).at(-1)!.data;
    expect(state.writeRelays[OUTBOX].deleteSupport).toBe("not-advertised");
    expect(marmotRelayOutcome(state).status).toBe("warning");
  });

  it("does not report public KeyPackage metadata as fully healthy MLS", () => {
    mocks.list.mockReturnValue(of(null));
    mocks.relay.mockReturnValue({
      authRequiredForRead$: of(false),
      request: () => of(candidate),
    });
    const state = collect(packagesLoader(subject(of([LOOKUP])))).at(-1)!.data;
    expect(keyPackageOutcome(state).status).toBe("warning");
    expect(keyPackageOutcome(state).summary).toContain("unvalidated");
    expect(hasUnresolvedChecks({ packages: keyPackageOutcome(state) })).toBe(
      true,
    );
  });
});

describe("final diagnostic summary", () => {
  it.each(["warning", "error", "skipped", "notfound"] as const)(
    "preserves an unresolved %s result",
    (status) => {
      expect(hasUnresolvedChecks({ report: { status, summary: "" } })).toBe(
        true,
      );
    },
  );
  it("permits a clean summary only when all recorded checks are clean or fixed", () => {
    expect(
      hasUnresolvedChecks({
        first: { status: "clean", summary: "" },
        second: { status: "fixed", summary: "" },
      }),
    ).toBe(false);
  });
});
