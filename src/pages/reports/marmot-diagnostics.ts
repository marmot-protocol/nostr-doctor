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

export const CURRENT_KEY_PACKAGE_KIND = 30443;
export const CURRENT_INBOX_RELAYS_KIND = 10050;
export const NIP65_RELAY_LIST_KIND = 10002;
export const WELCOME_KIND = 1059;
export const DELETE_EVENT_KIND = 5;
export const LEGACY_KEY_PACKAGE_KIND = 443;
export const LEGACY_KEY_PACKAGE_RELAYS_KIND = 10051;

export type RelayFetch = {
  relayUrl: string;
  events: NostrEvent[];
  error: boolean;
};

export type CurrentPackageStatus =
  | "deleted"
  | "expired"
  | "malformed"
  | "unsupported-mls"
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
  status: CurrentPackageStatus;
  detail: string;
};

export type LegacyKeyPackage = {
  id: string;
  event: NostrEvent;
  deviceCandidate: string | null;
  client: string | null;
  createdAt: number;
  foundOnRelays: string[];
};

function latestFirst(a: NostrEvent, b: NostrEvent): number {
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return a.id.localeCompare(b.id);
}

function tagValue(event: NostrEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

function hasDecodableBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 === 1) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    return atob(value).length > 0;
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
  if (
    deletion.kind !== DELETE_EVENT_KIND ||
    deletion.pubkey !== event.pubkey ||
    deletion.created_at < event.created_at
  ) {
    return false;
  }

  const address = getReplaceableAddress(event);
  return (
    getDeleteIds(deletion).includes(event.id) ||
    (address !== null && getDeleteAddressStrings(deletion).includes(address))
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

  const publicationSlot = getReplaceableIdentifier(event);
  if (!publicationSlot) {
    return {
      status: "malformed",
      detail: "missing non-empty d publication slot",
    };
  }

  if (
    tagValue(event, "encoding") !== "base64" ||
    !hasDecodableBase64(event.content)
  ) {
    return {
      status: "malformed",
      detail: "content is not declared, decodable base64",
    };
  }

  const protocolVersion = tagValue(event, "mls_protocol_version");
  const ciphersuite = tagValue(event, "mls_ciphersuite");
  const relays = event.tags.find((tag) => tag[0] === "relays")?.slice(1) ?? [];
  if (!protocolVersion || !ciphersuite || relays.length === 0) {
    return {
      status: "malformed",
      detail: "missing required MLS metadata or relay tags",
    };
  }

  if (protocolVersion !== "1.0" || ciphersuite.toLowerCase() !== "0x0001") {
    return {
      status: "unsupported-mls",
      detail: `declares MLS ${protocolVersion} / ${ciphersuite}, outside the maintained Marmot baseline`,
    };
  }

  return {
    status: "unvalidated-mls",
    detail:
      "metadata and base64 are well formed; MLS bytes and lifetime are not validated because no maintained shared parser is installed",
  };
}

export function summarizeCurrentPackages(
  fetches: RelayFetch[],
  expectedRelays: string[],
  expectedPubkey: string,
  now: number,
): CurrentKeyPackage[] {
  const currentEvents = fetches.flatMap((fetch) =>
    fetch.events.filter((event) => event.kind === CURRENT_KEY_PACKAGE_KIND),
  );
  const deletions = fetches.flatMap((fetch) =>
    fetch.events.filter((event) => event.kind === DELETE_EVENT_KIND),
  );

  return collapseCurrentReplacements(currentEvents).map((event) => {
    const foundOnRelays = fetches
      .filter((fetch) =>
        fetch.events.some((candidate) => candidate.id === event.id),
      )
      .map((fetch) => fetch.relayUrl);
    const missingFromRelays = expectedRelays.filter(
      (relay) => !foundOnRelays.includes(relay),
    );
    const validation = validateCurrentMetadata(event, expectedPubkey);
    const expiration = getExpirationTimestamp(event);

    let status: CurrentPackageStatus = validation.status;
    let detail = validation.detail;
    if (deletions.some((deletion) => deletionTargetsEvent(deletion, event))) {
      status = "deleted";
      detail =
        "a valid-author kind 5 deletion targets this event or publication slot";
    } else if (expiration !== undefined && expiration <= now) {
      status = "expired";
      detail = `NIP-40 expiration ${expiration} is in the past`;
    } else if (
      validation.status === "unvalidated-mls" &&
      missingFromRelays.length > 0
    ) {
      status = "partial-relay";
      detail = `missing from ${missingFromRelays.length} expected NIP-65 relay${missingFromRelays.length === 1 ? "" : "s"}`;
    }

    return {
      id: event.id,
      event,
      publicationSlot: getReplaceableIdentifier(event),
      client: tagValue(event, "client"),
      createdAt: event.created_at,
      foundOnRelays,
      missingFromRelays,
      status,
      detail,
    };
  });
}

export function summarizeLegacyPackages(
  fetches: RelayFetch[],
): LegacyKeyPackage[] {
  const byId = new Map<string, NostrEvent>();
  for (const fetch of fetches) {
    for (const event of fetch.events) {
      if (event.kind === LEGACY_KEY_PACKAGE_KIND) byId.set(event.id, event);
    }
  }

  return [...byId.values()].sort(latestFirst).map((event) => ({
    id: event.id,
    event,
    deviceCandidate: tagValue(event, "device") ?? tagValue(event, "d"),
    client: tagValue(event, "client"),
    createdAt: event.created_at,
    foundOnRelays: fetches
      .filter((fetch) =>
        fetch.events.some((candidate) => candidate.id === event.id),
      )
      .map((fetch) => fetch.relayUrl),
  }));
}
