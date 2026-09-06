import { finalizeEvent } from "applesauce-core/helpers";
import { EventFactory } from "applesauce-core/event-factory";
import { bytesToHex } from "@noble/hashes/utils.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { x448 } from "@noble/curves/ed448.js";
import { p256, p384, p521 } from "@noble/curves/nist.js";
import type { KeyPackage, LeafNodeKeyPackage, CustomExtension } from "ts-mls";
import {
  encode,
  mlsMessageEncoder,
  keyPackageTBSEncoder,
  signWithLabel,
  signLeafNodeKeyPackage,
  makeKeyPackageRef,
} from "ts-mls/diagnostics";
import { suiteCrypto } from "../crypto.ts";
import { hexId } from "../key-package-validation.ts";

export const NOW = 1_800_000_000;
export const ACCOUNT_SECRET = new Uint8Array(32).fill(3);
export const ACCOUNT = bytesToHex(schnorr.getPublicKey(ACCOUNT_SECRET));
export const COMPONENTS = [1, 0x8003, 0x8004, 0x8009, 0x800c];
const factory = new EventFactory();
const concat = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
export const u16 = (v: number) => Uint8Array.of(v >>> 8, v & 255);
export function vector(data: Uint8Array) {
  const length = data.length;
  const prefix =
    length < 64
      ? Uint8Array.of(length)
      : length < 16384
        ? Uint8Array.of(64 | (length >>> 8), length & 255)
        : Uint8Array.of(
            128 | (length >>> 24),
            (length >>> 16) & 255,
            (length >>> 8) & 255,
            length & 255,
          );
  return concat(prefix, data);
}
export const componentIds = (ids: number[]) => vector(concat(...ids.map(u16)));
export const dictionary = (entries: [number, Uint8Array][]) =>
  vector(concat(...entries.map(([id, data]) => concat(u16(id), vector(data)))));
export const extension = (type: number, data: Uint8Array) =>
  ({ extensionType: type, extensionData: data }) as CustomExtension;

export async function fixture(
  options: {
    suite?: number;
    modifyLeaf?: (leaf: Omit<LeafNodeKeyPackage, "signature">) => void;
    modifyPackage?: (kp: KeyPackage) => void;
    modifyTags?: (tags: string[][]) => string[][];
    components?: number[];
    proofMutation?: (proof: Uint8Array) => void;
    proofTime?: number;
    lastResort?: boolean;
    lifetime?: { notBefore: bigint; notAfter: bigint };
  } = {},
) {
  const suite = options.suite ?? 1;
  const cs = suiteCrypto(suite)!;
  const sig = await cs.signature.keygen();
  const encryptionKey = () => {
    const curve =
      suite === 1 || suite === 3
        ? x25519
        : suite === 4 || suite === 6
          ? x448
          : suite === 2
            ? p256
            : suite === 5
              ? p521
              : p384;
    return curve.getPublicKey(curve.utils.randomSecretKey(), false);
  };
  const template = await factory.build({
    kind: 450,
    created_at: options.proofTime ?? NOW - 100,
    content: "Authorize this MLS leaf key for my Marmot account",
    tags: [
      ["d", "marmot.account-identity-proof.v2"],
      ["component", "0x8009"],
      ["ciphersuite", hexId(suite)],
      ["signature_scheme", hexId(cs.scheme)],
      ["mls_signature_key", bytesToHex(sig.publicKey)],
    ],
  });
  const proofEvent = finalizeEvent(template, ACCOUNT_SECRET);
  const proof = new Uint8Array(104);
  proof.set(schnorr.getPublicKey(ACCOUNT_SECRET));
  new DataView(proof.buffer).setBigUint64(32, BigInt(proofEvent.created_at));
  proof.set(
    Uint8Array.from(proofEvent.sig.match(/../g)!, (x) => parseInt(x, 16)),
    40,
  );
  options.proofMutation?.(proof);
  const components = options.components ?? COMPONENTS;
  const leaf = {
    hpkePublicKey: encryptionKey(),
    signaturePublicKey: sig.publicKey,
    credential: {
      credentialType: 1 as const,
      identity: schnorr.getPublicKey(ACCOUNT_SECRET),
    },
    capabilities: {
      versions: [1],
      ciphersuites: [suite],
      extensions: [6],
      proposals: [8],
      credentials: [1],
    },
    leafNodeSource: 1 as const,
    lifetime: options.lifetime ?? {
      notBefore: BigInt(NOW - 60),
      notAfter: BigInt(NOW + 86400 * 30),
    },
    extensions: [
      extension(
        6,
        dictionary([
          [1, componentIds(components)],
          [2, componentIds([])],
          [0x8009, proof],
        ]),
      ),
    ],
  };
  options.modifyLeaf?.(leaf);
  const kp: KeyPackage = {
    version: 1,
    cipherSuite: suite,
    initKey: encryptionKey(),
    leafNode: await signLeafNodeKeyPackage(leaf, sig.signKey, cs.signature),
    extensions: options.lastResort
      ? [extension(6, dictionary([[4, new Uint8Array()]]))]
      : [],
    signature: new Uint8Array(),
  };
  options.modifyPackage?.(kp);
  kp.signature = await signWithLabel(
    sig.signKey,
    "KeyPackageTBS",
    encode(keyPackageTBSEncoder, kp),
    cs.signature,
  );
  const reference = bytesToHex(await makeKeyPackageRef(kp, cs.hash));
  let tags = [
    ["d", "b".repeat(64)],
    ["i", reference],
    ["mls_protocol_version", "1.0"],
    ["mls_ciphersuite", hexId(suite)],
    ["mls_extensions", ...kp.leafNode.capabilities.extensions.map(hexId)],
    ["mls_proposals", ...kp.leafNode.capabilities.proposals.map(hexId)],
    ["app_components", ...components.map(hexId)],
  ];
  tags = options.modifyTags?.(tags) ?? tags;
  const bytes = encode(mlsMessageEncoder, {
    version: 1,
    wireformat: 5,
    keyPackage: kp,
  });
  const event = finalizeEvent(
    await factory.build({
      kind: 30443,
      tags,
      content: btoa(String.fromCharCode(...bytes)),
      created_at: NOW,
    }),
    ACCOUNT_SECRET,
  );
  return { event, kp, proof, reference, bytes };
}
