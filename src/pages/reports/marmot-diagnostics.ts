import {
  getDeleteAddressStrings,
  getDeleteIds,
} from "applesauce-core/helpers/delete";
import {
  getReplaceableAddress,
  getReplaceableIdentifier,
  type NostrEvent,
} from "applesauce-core/helpers/event";
import { getExpirationTimestamp } from "applesauce-core/helpers/expiration";
import type { KeyPackageValidation } from "../../lib/marmot/key-package-validation.ts";

export const CURRENT_KEY_PACKAGE_KIND = 30443;
export const CURRENT_INBOX_RELAYS_KIND = 10050;
export const NIP65_RELAY_LIST_KIND = 10002;
export const GIFT_WRAP_KIND = 1059;
export const DELETE_EVENT_KIND = 5;
export const LEGACY_KEY_PACKAGE_KIND = 443;
export const LEGACY_KEY_PACKAGE_RELAYS_KIND = 10051;

export type RelayFetch = {
  relayUrl: string;
  events: NostrEvent[];
  error: boolean;
  complete: boolean;
  invalidEvents?: number;
  authRequired?: boolean;
};

export type CurrentPackageStatus =
  | "valid"
  | "invalid-mls"
  | "deletion-requested"
  | "relay-expired"
  | "malformed"
  | "unsupported-mls"
  | "relay-unverified"
  | "partial-relay"
  | "unvalidated-mls";

export type CurrentKeyPackage = {
  id: string;
  event: NostrEvent;
  publicationSlot: string;
  client: string | null;
  createdAt: number;
  foundOnRelays: string[];
  missingFromRelays: string[];
  uncheckedRelays: string[];
  status: CurrentPackageStatus;
  detail: string;
  mls?: KeyPackageValidation;
  selected: boolean;
};

function latestFirst(a: NostrEvent, b: NostrEvent): number {
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return a.id.localeCompare(b.id);
}

function tagValue(event: NostrEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

function hasCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 === 1) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    const decoded = atob(value);
    return decoded.length > 0 && btoa(decoded) === value;
  } catch {
    return false;
  }
}

export function collapseCurrentReplacements(
  events: NostrEvent[],
): NostrEvent[] {
  const byAddress = new Map<string, NostrEvent>();

  for (const event of events) {
    const address = getReplaceableAddress(event);
    if (!address) continue;
    const existing = byAddress.get(address);
    if (!existing || latestFirst(event, existing) < 0) {
      byAddress.set(address, event);
    }
  }

  return [...byAddress.values()].sort(latestFirst);
}

export function deletionTargetsEvent(
  deletion: NostrEvent,
  event: NostrEvent,
): boolean {
  if (deletion.kind !== DELETE_EVENT_KIND || deletion.pubkey !== event.pubkey) {
    return false;
  }

  const address = getReplaceableAddress(event);
  return (
    getDeleteIds(deletion).includes(event.id) ||
    (deletion.created_at >= event.created_at &&
      address !== null &&
      getDeleteAddressStrings(deletion).includes(address))
  );
}

function validateCurrentMetadata(
  event: NostrEvent,
  expectedPubkey: string,
): {
  status: "malformed" | "unsupported-mls" | "unvalidated-mls";
  detail: string;
} {
  if (event.pubkey !== expectedPubkey) {
    return {
      status: "malformed",
      detail: "author does not match the diagnosed account",
    };
  }

  // Current transport profile: no encoding negotiation or per-package relays.
  // https://github.com/marmot-protocol/marmot/blob/master/transports/nostr.md
  if (event.tags.some((tag) => tag[0] === "encoding" || tag[0] === "relays")) {
    return {
      status: "malformed",
      detail: "legacy encoding/relays tags are not part of current KeyPackages",
    };
  }
  if (!hasCanonicalBase64(event.content)) {
    return {
      status: "malformed",
      detail: "content is not canonical padded base64",
    };
  }

  for (const name of ["d", "i", "mls_protocol_version"]) {
    const tags = event.tags.filter((tag) => tag[0] === name);
    if (tags.length !== 1 || tags[0].length !== 2 || !tags[0][1]) {
      return {
        status: "malformed",
        detail: `expected exactly one ${name} tag with one value`,
      };
    }
  }
  if (!/^[0-9a-f]{64}$/.test(getReplaceableIdentifier(event))) {
    return {
      status: "malformed",
      detail: "d must be a 32-byte lowercase hex publication slot",
    };
  }
  if (!/^(?:[0-9a-f]{2})+$/.test(tagValue(event, "i")!)) {
    return {
      status: "malformed",
      detail: "i must be a lowercase hex KeyPackageRef",
    };
  }

  const idLists = new Map<string, string[]>();
  for (const name of [
    "mls_ciphersuite",
    "mls_extensions",
    "mls_proposals",
    "app_components",
  ]) {
    const tags = event.tags.filter((tag) => tag[0] === name);
    const ids = tags[0]?.slice(1) ?? [];
    if (
      tags.length !== 1 ||
      ids.length === 0 ||
      ids.some((id) => !/^0x[0-9a-f]{4}$/.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      return {
        status: "malformed",
        detail: `${name} must be one non-empty list of distinct canonical 16-bit ids`,
      };
    }
    idLists.set(name, ids);
  }
  if (!idLists.get("app_components")!.includes("0x8009")) {
    return {
      status: "malformed",
      detail:
        "missing required account-identity-proof.v2 component advertisement (0x8009)",
    };
  }
  const protocolVersion = tagValue(event, "mls_protocol_version");
  if (
    protocolVersion !== "1.0" ||
    !idLists.get("mls_extensions")!.includes("0x0006") ||
    !idLists.get("mls_proposals")!.includes("0x0008")
  ) {
    return {
      status: "unsupported-mls",
      detail: "declarations do not support the current Marmot MLS baseline",
    };
  }

  return {
    status: "unvalidated-mls",
    detail:
      "public transport metadata is well formed; decoded MLS validation has not completed",
  };
}

export function summarizeCurrentPackages(
  fetches: RelayFetch[],
  expectedRelays: string[],
  expectedPubkey: string,
  now: number,
  validations: Map<string, KeyPackageValidation | undefined> = new Map(),
): CurrentKeyPackage[] {
  const currentEvents = fetches.flatMap((fetch) =>
    fetch.events.filter((event) => event.kind === CURRENT_KEY_PACKAGE_KIND),
  );
  const deletions = fetches.flatMap((fetch) =>
    fetch.events.filter((event) => event.kind === DELETE_EVENT_KIND),
  );

  const inventory = [
    ...new Map(currentEvents.map((event) => [event.id, event])).values(),
  ].sort(latestFirst);
  const packages: CurrentKeyPackage[] = inventory.map((event) => {
    const foundOnRelays = fetches
      .filter((fetch) =>
        fetch.events.some((candidate) => candidate.id === event.id),
      )
      .map((fetch) => fetch.relayUrl);
    const absentRelays = expectedRelays.filter(
      (relay) => !foundOnRelays.includes(relay),
    );
    const missingFromRelays = absentRelays.filter((relay) =>
      fetches.some(
        (fetch) =>
          fetch.relayUrl === relay &&
          fetch.complete &&
          !fetch.error &&
          !fetch.invalidEvents,
      ),
    );
    const uncheckedRelays = absentRelays.filter(
      (relay) => !missingFromRelays.includes(relay),
    );
    const validation = validateCurrentMetadata(event, expectedPubkey);
    const mls = validations.get(event.id);
    const expiration = getExpirationTimestamp(event);

    let status: CurrentPackageStatus = validation.status;
    let detail = validation.detail;
    if (validation.status === "unvalidated-mls" && mls) {
      status =
        mls.status === "invalid"
          ? "invalid-mls"
          : mls.status === "valid"
            ? "valid"
            : "unvalidated-mls";
      detail =
        mls.status === "valid"
          ? "Public MLS package checks passed; private-key possession and Welcome processing still require the recipient's client."
          : (mls.checks.find(
              (check) =>
                check.status === "fail" || check.status === "unverified",
            )?.detail ?? detail);
    }
    if (deletions.some((deletion) => deletionTargetsEvent(deletion, event))) {
      status = "deletion-requested";
      detail =
        "a signed kind 5 deletion request targets this publication; it is still retrievable on the listed relays";
    } else if (expiration !== undefined && expiration <= now) {
      status = "relay-expired";
      detail = `NIP-40 relay expiration ${expiration} has passed; the internal MLS lifetime is not validated`;
    } else if (
      (status === "valid" || status === "unvalidated-mls") &&
      missingFromRelays.length > 0
    ) {
      status = "partial-relay";
      detail = `missing from ${missingFromRelays.length} expected NIP-65 relay${missingFromRelays.length === 1 ? "" : "s"}`;
    } else if (
      (status === "valid" || status === "unvalidated-mls") &&
      uncheckedRelays.length > 0
    ) {
      status = "relay-unverified";
      detail = `retrieval could not be verified on ${uncheckedRelays.length} expected relay(s)`;
    }

    return {
      id: event.id,
      event,
      publicationSlot: getReplaceableIdentifier(event),
      client: tagValue(event, "client"),
      createdAt: event.created_at,
      foundOnRelays,
      missingFromRelays,
      uncheckedRelays,
      status,
      detail,
      mls,
      selected: false,
    };
  });
  // Select the freshest VALID publication within a slot. Retain broken newer
  // revisions in the report instead of hiding them or letting them mask a usable one.
  const selectedSlots = new Set<string>();
  for (const pkg of packages) {
    if (
      pkg.mls?.status !== "valid" ||
      !["valid", "partial-relay", "relay-unverified"].includes(pkg.status)
    )
      continue;
    const address = getReplaceableAddress(pkg.event)!;
    if (!selectedSlots.has(address)) {
      pkg.selected = true;
      selectedSlots.add(address);
    }
  }
  return packages;
}

/** Validate before connection normalization; signed relay metadata is never rewritten. */
export function isMarmotRelayUrl(value: string): boolean {
  if (
    new TextEncoder().encode(value).length > 512 ||
    value !== value.trim() ||
    [...value].some((char) => {
      const code = char.codePointAt(0)!;
      return code <= 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    }) ||
    value.includes("\\")
  )
    return false;
  try {
    const url = new URL(value);
    return (
      /^wss?:\/\//i.test(value) &&
      (url.protocol === "wss:" || url.protocol === "ws:") &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !value.includes("#")
    );
  } catch {
    return false;
  }
}

export function readRelayList(event: NostrEvent) {
  const urls: string[] = [];
  const invalidUrls: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== (event.kind === NIP65_RELAY_LIST_KIND ? "r" : "relay"))
      continue;
    const url = tag[1] ?? "";
    if (!isMarmotRelayUrl(url)) {
      invalidUrls.push(url);
      continue;
    }
    if (
      event.kind === NIP65_RELAY_LIST_KIND &&
      tag[2] !== undefined &&
      tag[2] !== "write"
    )
      continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return { urls, invalidUrls };
}
