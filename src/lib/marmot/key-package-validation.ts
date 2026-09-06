import { verifySignedEvent } from "./verify-signed-event.ts";
import { EventFactory } from "applesauce-core/event-factory";
import { getEventHash, type NostrEvent } from "applesauce-core/helpers";
import { bytesToHex } from "@noble/hashes/utils.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  mlsMessageDecoder,
  mlsMessageEncoder,
  encode,
  makeKeyPackageRef,
  verifyKeyPackage,
  verifyLeafNodeSignatureKeyPackage,
} from "ts-mls/diagnostics";
import type { KeyPackage } from "ts-mls";
import { decodeDictionary, decodeComponentIds } from "./components.ts";
import { equalBytes, suiteCrypto } from "./crypto.ts";
import { MAX_KEY_PACKAGE_BYTES } from "./validation-types.ts";
export { MAX_KEY_PACKAGE_BYTES } from "./validation-types.ts";

export type ValidationCheck = {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "unverified";
  detail: string;
  remedy?: string;
};
export type KeyPackageValidation = {
  status: "valid" | "invalid" | "unverified";
  checks: ValidationCheck[];
  ciphersuite?: number;
  keyPackageRef?: string;
  notBefore?: string;
  notAfter?: string;
  components?: number[];
  lastResort?: boolean;
};
export const MAX_KEY_PACKAGE_LIFETIME_SECONDS = 7_261_200n;
export const KEY_PACKAGE_RENEWAL_NOTICE_SECONDS = 7n * 24n * 60n * 60n;
const factory = new EventFactory();
export const hexId = (id: number) => `0x${id.toString(16).padStart(4, "0")}`;
const renew =
  "Open an up-to-date Marmot client and publish a fresh KeyPackage.";

export function unverifiedPackage(detail: string): KeyPackageValidation {
  return {
    status: "unverified",
    checks: [
      {
        id: "validation",
        label: "Public KeyPackage validation",
        status: "unverified",
        detail,
        remedy: "Retry this diagnostic in a current browser.",
      },
    ],
  };
}

/** Public-data-only validation. Does not sign, publish, or decrypt a message. */
export async function validatePublicKeyPackage(
  event: NostrEvent,
  pubkey: string,
  now: number,
): Promise<KeyPackageValidation> {
  const result: KeyPackageValidation = { status: "valid", checks: [] };
  const add = (
    id: string,
    label: string,
    status: ValidationCheck["status"],
    detail: string,
    remedy?: string,
  ) => {
    result.checks.push({
      id,
      label,
      status,
      detail,
      ...(remedy ? { remedy } : {}),
    });
    if (status === "fail") result.status = "invalid";
    else if (status === "unverified" && result.status !== "invalid")
      result.status = "unverified";
  };
  const check = async (
    id: string,
    label: string,
    work: () => boolean | Promise<boolean>,
    pass: string,
    fail: string,
    remedy = renew,
  ) => {
    try {
      const valid = await work();
      add(
        id,
        label,
        valid ? "pass" : "fail",
        valid ? pass : fail,
        valid ? undefined : remedy,
      );
    } catch {
      add(id, label, "fail", fail, remedy);
    }
  };
  await check(
    "nostr",
    "Signed account publication",
    () =>
      event.kind === 30443 &&
      event.pubkey === pubkey &&
      verifySignedEvent(event),
    "Nostr signature and account author match.",
    "The signed publication does not match this account.",
  );
  if (result.status === "invalid") return result;
  if (event.content.length > Math.ceil(MAX_KEY_PACKAGE_BYTES / 3) * 4) {
    add(
      "framing",
      "MLS message framing",
      "unverified",
      "Package exceeds Doctor's 64 KiB validation limit.",
      "Inspect this unusually large publication in the publishing client.",
    );
    return result;
  }
  let kp: KeyPackage;
  try {
    const raw = atob(event.content);
    if (!raw.length || btoa(raw) !== event.content)
      throw new Error("Noncanonical base64");
    if (raw.length > MAX_KEY_PACKAGE_BYTES)
      return unverifiedPackage(
        "Package exceeds Doctor's 64 KiB validation limit.",
      );
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const decoded = mlsMessageDecoder(bytes, 0);
    if (
      !decoded ||
      decoded[1] !== bytes.length ||
      decoded[0].wireformat !== 5 ||
      decoded[0].version !== 1 ||
      !equalBytes(encode(mlsMessageEncoder, decoded[0]), bytes)
    )
      throw new Error("Expected exactly one canonical MLSMessage(KeyPackage)");
    kp = decoded[0].keyPackage;
    if (kp.version !== 1) throw new Error("Invalid MLS version");
    add(
      "framing",
      "MLS message framing",
      "pass",
      "Canonical MLS 1.0 message containing a public KeyPackage.",
    );
  } catch {
    add(
      "framing",
      "MLS message framing",
      "fail",
      "Content is not one canonical, complete MLS 1.0 KeyPackage message.",
      renew,
    );
    return result;
  }
  result.ciphersuite = kp.cipherSuite;
  const leaf = kp.leafNode;
  const crypto = suiteCrypto(kp.cipherSuite);
  if (crypto) {
    await check(
      "leaf-signature",
      "MLS leaf signature",
      () => verifyLeafNodeSignatureKeyPackage(leaf, crypto.signature),
      "LeafNode signature verifies.",
      "LeafNode signature is invalid.",
    );
    await check(
      "package-signature",
      "MLS package signature",
      () => verifyKeyPackage(kp, crypto.signature),
      "KeyPackage signature verifies.",
      "KeyPackage signature is invalid.",
    );
    await check(
      "encryption-keys",
      "Public encryption keys",
      () => {
        crypto.validateEncryptionKey(kp.initKey);
        crypto.validateEncryptionKey(leaf.hpkePublicKey);
        return !equalBytes(kp.initKey, leaf.hpkePublicKey);
      },
      "Init and leaf encryption keys are valid, usable public keys and differ.",
      "An encryption key is invalid, low-order, or reused as both init and leaf key.",
    );
    result.keyPackageRef = bytesToHex(await makeKeyPackageRef(kp, crypto.hash));
    await check(
      "reference",
      "KeyPackage reference",
      () =>
        event.tags.filter((t) => t[0] === "i").length === 1 &&
        event.tags.find((t) => t[0] === "i")?.[1] === result.keyPackageRef,
      "The i tag matches the hash of the decoded KeyPackage.",
      "The i tag does not match the decoded KeyPackageRef.",
    );
  } else {
    add(
      "cryptography",
      "MLS cryptography",
      "unverified",
      `Ciphersuite ${hexId(kp.cipherSuite)} is not supported by this validator. Signatures, encryption keys and reference remain unverified.`,
      "Use a client supporting this suite to inspect it; keep a baseline 0x0001 package available for interoperability.",
    );
  }
  let identity: Uint8Array | undefined;
  await check(
    "identity",
    "Account credential",
    () => {
      if (
        leaf.credential.credentialType !== 1 ||
        !("identity" in leaf.credential)
      )
        return false;
      identity = leaf.credential.identity;
      if (identity.length !== 32 || bytesToHex(identity) !== event.pubkey)
        return false;
      schnorr.utils.lift_x(BigInt(`0x${bytesToHex(identity)}`));
      return true;
    },
    "Raw 32-byte account credential is a valid Nostr key and matches the author.",
    "Credential is not this account's valid 32-byte Nostr public key.",
  );

  const before = leaf.lifetime.notBefore;
  const after = leaf.lifetime.notAfter;
  result.notBefore = before.toString();
  result.notAfter = after.toString();
  await check(
    "lifetime",
    "MLS lifetime",
    () =>
      before <= after &&
      after - before <= MAX_KEY_PACKAGE_LIFETIME_SECONDS &&
      before <= BigInt(now) &&
      BigInt(now) <= after,
    `Valid now, from ${before} through ${after} (Unix seconds), within Marmot's 84-day + 1-hour bound.`,
    before > BigInt(now)
      ? "Package is not valid yet. Check the publishing device's clock."
      : after < BigInt(now)
        ? "The embedded MLS lifetime has expired."
        : "The MLS lifetime is reversed or exceeds 84 days plus one hour.",
  );
  if (
    before <= BigInt(now) &&
    after >= BigInt(now) &&
    after - BigInt(now) <= KEY_PACKAGE_RENEWAL_NOTICE_SECONDS
  )
    add(
      "renewal",
      "Upcoming renewal",
      "warning",
      "This package expires within seven days.",
      "Open the publishing client soon so it can renew its package.",
    );

  let dictionary: Map<number, Uint8Array> | undefined;
  let packageDictionary: Map<number, Uint8Array> | undefined;
  await check(
    "components",
    "Application component structure",
    () => {
      for (const extensions of [leaf.extensions, kp.extensions]) {
        if (
          new Set(extensions.map((e) => e.extensionType)).size !==
          extensions.length
        )
          return false;
      }
      const carrier = leaf.extensions.find((e) => e.extensionType === 6);
      if (!carrier || !(carrier.extensionData instanceof Uint8Array))
        return false;
      dictionary = decodeDictionary(carrier.extensionData);
      const outer = kp.extensions.find((e) => e.extensionType === 6);
      packageDictionary = outer
        ? decodeDictionary(outer.extensionData)
        : new Map();
      // Known group-only/authorization components must not masquerade as leaf data.
      const wrongLocation = (id: number) =>
        id >= 0x8001 && id <= 0x800c && id !== 0x8009;
      if (
        [...dictionary.keys()].some(
          (id) => [0, 4, 5].includes(id) || wrongLocation(id),
        ) ||
        [...packageDictionary.keys()].some(
          (id) =>
            [0, 1, 2, 3, 5].includes(id) || (id >= 0x8001 && id <= 0x800c),
        )
      )
        return false;
      const supported = dictionary.get(1);
      if (!supported) return false;
      result.components = decodeComponentIds(supported);
      if (dictionary.has(2)) decodeComponentIds(dictionary.get(2)!);
      result.lastResort = packageDictionary.has(4);
      if (result.lastResort && packageDictionary.get(4)!.length !== 0)
        return false;
      return (
        result.components.includes(1) && result.components.includes(0x8009)
      );
    },
    "Component dictionaries, support list and last-resort placement are well formed.",
    "Missing, duplicated, unsorted, or misplaced application components.",
  );

  await check(
    "capabilities",
    "Decoded Marmot capabilities",
    () => {
      const caps = leaf.capabilities;
      return (
        caps.versions.includes(1) &&
        caps.ciphersuites.includes(kp.cipherSuite) &&
        caps.credentials.includes(1) &&
        caps.extensions.includes(6) &&
        caps.proposals.includes(8) &&
        !caps.extensions.some((id) => id >= 1 && id <= 5) &&
        !caps.proposals.some((id) => id >= 1 && id <= 7) &&
        leaf.extensions.every(
          (e) =>
            e.extensionType === 1 || caps.extensions.includes(e.extensionType),
        ) &&
        leaf.extensions.every(
          (e) =>
            ![2, 3, 4, 5, 0xf2f1, 0xf2d1, 0xf2d2, 0xf2d4].includes(
              e.extensionType,
            ),
        ) &&
        kp.extensions.every(
          (e) =>
            ![1, 2, 3, 4, 5, 0xf2f1, 0xf2d1, 0xf2d2, 0xf2d4].includes(
              e.extensionType,
            ),
        )
      );
    },
    "Leaf supports MLS 1.0, its suite, BasicCredential, app_data_dictionary and app_data_update.",
    "Decoded capabilities or extension placement do not satisfy the current Marmot baseline.",
  );
  await check(
    "advertisements",
    "Public tags match MLS data",
    () => {
      const matches = (name: string, values: number[]) => {
        const tags = event.tags.filter((t) => t[0] === name);
        const listed = tags[0]?.slice(1) ?? [];
        return (
          tags.length === 1 &&
          listed.length === new Set(values).size &&
          new Set(listed).size === listed.length &&
          values.every((v) => listed.includes(hexId(v)))
        );
      };
      // The transport advertises Marmot components, not necessarily the entire
      // MLS support list. In particular, upstream app_components (0x0001) may
      // be omitted here; it is still mandatory in the signed LeafNode above.
      // Every public claim must be backed by that signed list, including any
      // upstream or future component ids the publisher chooses to include.
      // https://github.com/marmot-protocol/marmot/blob/master/transports/nostr.md#keypackage-publication
      const componentTags = event.tags.filter((t) => t[0] === "app_components");
      const advertisedComponents = componentTags[0]?.slice(1) ?? [];
      const supportedComponents = new Set((result.components ?? []).map(hexId));
      const componentsMatch =
        componentTags.length === 1 &&
        advertisedComponents.includes("0x8009") &&
        new Set(advertisedComponents).size === advertisedComponents.length &&
        advertisedComponents.every((id) => supportedComponents.has(id));
      return (
        event.tags.filter((t) => t[0] === "mls_protocol_version").length ===
          1 &&
        event.tags.find((t) => t[0] === "mls_protocol_version")?.[1] ===
          "1.0" &&
        matches("mls_ciphersuite", [kp.cipherSuite]) &&
        matches("mls_extensions", leaf.capabilities.extensions) &&
        matches("mls_proposals", leaf.capabilities.proposals) &&
        componentsMatch
      );
    },
    "MLS tags match the decoded package; advertised components are supported by the signed LeafNode and include 0x8009.",
    "Public capability tags disagree with the signed MLS data.",
  );

  if (crypto) {
    await check(
      "account-proof",
      "Account identity proof v2",
      async () => {
        const proof = dictionary?.get(0x8009);
        if (
          !proof ||
          proof.length !== 104 ||
          !identity ||
          !equalBytes(proof.subarray(0, 32), identity)
        )
          return false;
        const timestamp = new DataView(
          proof.buffer,
          proof.byteOffset + 32,
          8,
        ).getBigUint64(0);
        if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        const template = await factory.build({
          kind: 450,
          created_at: Number(timestamp),
          tags: [
            ["d", "marmot.account-identity-proof.v2"],
            ["component", "0x8009"],
            ["ciphersuite", hexId(kp.cipherSuite)],
            ["signature_scheme", hexId(crypto.scheme)],
            ["mls_signature_key", bytesToHex(leaf.signaturePublicKey)],
          ],
          content: "Authorize this MLS leaf key for my Marmot account",
        });
        const unsigned = { ...template, pubkey: bytesToHex(identity) };
        return verifySignedEvent({
          ...unsigned,
          id: getEventHash(unsigned),
          sig: bytesToHex(proof.subarray(40)),
        });
      },
      "The account authorized this exact MLS leaf key and ciphersuite (v2 proof verifies).",
      "Account identity proof is missing, malformed, or does not authorize this leaf key.",
    );
  } else
    add(
      "account-proof",
      "Account identity proof v2",
      "unverified",
      "Cannot validate the proof's leaf-key binding for an unsupported ciphersuite.",
    );

  const missing = [0x8003, 0x8004, 0x800c].filter(
    (id) => !result.components?.includes(id),
  );
  if (missing.length)
    add(
      "group-support",
      "Current group feature support",
      "warning",
      `Not advertised: ${missing.map((id) => (id === 0x8003 ? "admin policy" : id === 0x8004 ? "Nostr group routing" : "group lifecycle")).join(", ")}. Groups requiring these cannot add this package.`,
      "Update the publishing client and refresh its KeyPackage for broader group compatibility.",
    );
  if (result.lastResort)
    add(
      "last-resort",
      "Reusable package",
      "warning",
      "This is a last-resort package. Valid single-use packages are preferred when available.",
      "Keep the publishing client online periodically to refresh its KeyPackages.",
    );
  return result;
}
