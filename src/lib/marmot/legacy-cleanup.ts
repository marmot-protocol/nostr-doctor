import {
  modifyPublicTags,
  includeNameValueTag,
} from "applesauce-core/operations";
import { setDeleteEvents } from "applesauce-core/operations/delete";
import { addEventPointerTag } from "applesauce-core/operations/tag/common";
import { relaySet } from "applesauce-core/helpers";
import { factory } from "../factory.ts";
import {
  isMarmotRelayUrl,
  LEGACY_KEY_PACKAGE_KIND,
  LEGACY_KEY_PACKAGE_RELAYS_KIND,
} from "../../pages/reports/marmot-diagnostics.ts";
import { isVerifiedEvent } from "../../pages/reports/marmot-loaders.ts";
import type { LegacyCleanupEvent } from "../../pages/reports/marmot-legacy-cleanup/loader.ts";

/** Bounded requests, exact ids, and source-relay hints that survive draft/referral serialization. */
export async function buildLegacyCleanup(
  entries: LegacyCleanupEvent[],
  pubkey: string,
) {
  const byRelay = new Map<string, Map<string, LegacyCleanupEvent>>();
  for (const entry of entries) {
    if (
      !isVerifiedEvent(entry.event, {
        authors: [pubkey],
        kinds: [LEGACY_KEY_PACKAGE_KIND, LEGACY_KEY_PACKAGE_RELAYS_KIND],
      })
    )
      throw new Error(
        "Cleanup can only target this account's signed legacy Marmot events.",
      );
    const relays = relaySet(entry.foundOnRelays.filter(isMarmotRelayUrl));
    if (!relays.length)
      throw new Error("No source relay is available for this legacy event.");
    for (const relay of relays) {
      const events =
        byRelay.get(relay) ?? new Map<string, LegacyCleanupEvent>();
      events.set(entry.event.id, entry);
      byRelay.set(relay, events);
    }
  }
  const requests = [];
  for (const [relay, events] of byRelay) {
    const all = [...events.values()];
    for (let offset = 0; offset < all.length; offset += 100) {
      const batch = all.slice(offset, offset + 100);
      requests.push(
        factory.build(
          {
            kind: 5,
            content:
              "Remove obsolete Marmot KeyPackages and KeyPackage relay lists.",
          },
          setDeleteEvents(batch.map(({ event }) => event.id)),
          ...[...new Set(batch.map(({ event }) => event.kind))].map((kind) =>
            includeNameValueTag(["k", String(kind)]),
          ),
          modifyPublicTags(
            ...batch.map(({ event }) =>
              addEventPointerTag({ id: event.id, relays: [relay] }, true),
            ),
          ),
        ),
      );
    }
  }
  return Promise.all(requests);
}
