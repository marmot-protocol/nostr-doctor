import {
  relaySet,
  type EventTemplate,
  type NostrEvent,
} from "applesauce-core/helpers";
import { isMarmotRelayUrl } from "../pages/reports/marmot-diagnostics.ts";
import { DEFAULT_RELAYS, pool } from "./relay.ts";

/** NIP-10 event-reference relay hints route deletion requests to observed copies. */
export function deletionRelayHints(event: EventTemplate): string[] {
  if (event.kind !== 5) return [];
  return relaySet(
    event.tags.flatMap((tag) =>
      tag[0] === "e" &&
      /^[0-9a-f]{64}$/.test(tag[1] ?? "") &&
      isMarmotRelayUrl(tag[2] ?? "")
        ? [tag[2]]
        : [],
    ),
  );
}

export async function publishReportEvent(
  event: NostrEvent,
  outboxes?: string[],
) {
  const required = deletionRelayHints(event);
  const responses = await pool.publish(
    relaySet(outboxes, DEFAULT_RELAYS, required),
    event,
  );
  const accepted = relaySet(
    responses
      .filter((response) => response.ok)
      .map((response) => response.from),
  );
  const missing = required.filter((relay) => !accepted.includes(relay));
  if (missing.length)
    throw new Error(
      `Deletion request was not acknowledged by: ${missing.join(", ")}. Retry to reach those relays.`,
    );
}
