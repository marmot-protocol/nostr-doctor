import { BlossomClient, createUploadAuth } from "blossom-client-sdk";
import type { Signer, BlobDescriptor } from "blossom-client-sdk";
import type { EventTemplate } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://cdn.satellite.earth",
];

// ---------------------------------------------------------------------------
// Signer adapter
// applesauce ISigner.signEvent returns a full NostrEvent (with id/sig/pubkey).
// blossom-client-sdk Signer expects (draft: EventTemplate) => Promise<SignedEvent>
// where SignedEvent = EventTemplate & { id, sig, pubkey }.
// The shapes are compatible — no transformation needed.
// ---------------------------------------------------------------------------

export function makeBlossomSigner(signer: ISigner): Signer {
  return (draft) => signer.signEvent(draft) as ReturnType<Signer>;
}

// ---------------------------------------------------------------------------
// JSONL serialisation
// Each EventTemplate already has pubkey injected by the caller.
// ---------------------------------------------------------------------------

export function encodeReferralJsonl(
  events: (EventTemplate & { pubkey: string })[],
): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

export function decodeReferralJsonl(
  jsonl: string,
): (EventTemplate & { pubkey: string })[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EventTemplate & { pubkey: string });
}

// ---------------------------------------------------------------------------
// BUD-10 referral path helpers
// App path: /ref/<sha256>?xs=<domain>&as=<pubkey>&sz=<size>
//
// Search params mirror the BUD-10 spec directly — no blossom: URI encoding.
// ---------------------------------------------------------------------------

/**
 * Build the app-relative path (and query string) for a referral link.
 * The path segment is just the bare sha256 hex — no scheme, no extension.
 */
export function buildReferralPath(
  sha256: string,
  size: number,
  uploadedServers: string[],
  uploaderPubkey?: string,
): string {
  const params = new URLSearchParams();
  for (const server of uploadedServers) {
    try {
      params.append("xs", new URL(server).hostname);
    } catch {
      // skip malformed server URLs
    }
  }
  if (uploaderPubkey) params.append("as", uploaderPubkey);
  params.append("sz", String(size));
  return `/ref/${sha256}?${params.toString()}`;
}

/**
 * Parse the BUD-10-style search params from the /ref/<sha256> route.
 * Returns null if the sha256 path param is invalid.
 */
export type ParsedReferralParams = {
  sha256: string;
  servers: string[]; // full https:// URLs reconstructed from xs hostnames
  authors: string[]; // hex pubkeys from as params
  size: number | null;
};

export function parseReferralParams(
  sha256: string,
  searchParams: URLSearchParams,
): ParsedReferralParams | null {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;

  const servers = searchParams
    .getAll("xs")
    .map((xs) => (xs.startsWith("http") ? xs : `https://${xs}`));
  const authors = searchParams.getAll("as");
  const szRaw = searchParams.get("sz");
  const size = szRaw ? parseInt(szRaw, 10) : null;

  return { sha256, servers, authors, size };
}

// ---------------------------------------------------------------------------
// Upload to multiple Blossom servers, return first successful BlobDescriptor
// and list of all servers it was successfully uploaded to.
// ---------------------------------------------------------------------------

export type UploadResult = {
  descriptor: BlobDescriptor;
  succeededServers: string[];
};

export async function uploadToBlossomServers(
  blob: Blob,
  servers: string[],
  signer: Signer,
): Promise<UploadResult> {
  // Create auth once — valid for all servers
  const auth = await createUploadAuth(signer, blob, {
    message: "Upload Dr. Nostr referral",
  });

  let descriptor: BlobDescriptor | null = null;
  const succeededServers: string[] = [];

  for (const server of servers) {
    try {
      const result = await BlossomClient.uploadBlob(server, blob, { auth });
      if (!descriptor) descriptor = result;
      succeededServers.push(server);
    } catch {
      // continue to next server
    }
  }

  if (!descriptor || succeededServers.length === 0) {
    throw new Error(
      "Failed to upload referral to all Blossom servers. Please try again.",
    );
  }

  return { descriptor, succeededServers };
}

// ---------------------------------------------------------------------------
// Full referral link creation
// Returns an absolute app URL: <origin>/ref/<sha256>?xs=...&as=...&sz=...
// ---------------------------------------------------------------------------

export async function createReferralLink(
  events: EventTemplate[],
  subjectPubkey: string,
  uploaderSigner: ISigner,
  servers: string[],
): Promise<string> {
  // Inject pubkey into every event template
  const stamped = events.map((e) => ({ ...e, pubkey: subjectPubkey }));
  const jsonl = encodeReferralJsonl(stamped);
  const blob = new Blob([jsonl], { type: "application/jsonl" });

  const blossomSigner = makeBlossomSigner(uploaderSigner);
  const { descriptor, succeededServers } = await uploadToBlossomServers(
    blob,
    servers,
    blossomSigner,
  );

  const uploaderPubkey = await uploaderSigner.getPublicKey();
  const path = buildReferralPath(
    descriptor.sha256,
    descriptor.size,
    succeededServers,
    uploaderPubkey,
  );

  return `${window.location.origin}${path}`;
}
