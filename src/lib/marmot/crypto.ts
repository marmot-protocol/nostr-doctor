import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { ed448, x448 } from "@noble/curves/ed448.js";
import { p256, p384, p521 } from "@noble/curves/nist.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import type { Hash, Signature } from "ts-mls";

export function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Standard RFC 9420 suites. No private account or recipient key is used. */
export function suiteCrypto(id: number) {
  if (id < 1 || id > 7) return undefined;
  const ed =
    id === 1 || id === 3 ? ed25519 : id === 4 || id === 6 ? ed448 : undefined;
  const ec = id === 2 ? p256 : id === 5 ? p521 : p384;
  const digest = id <= 3 ? sha256 : id === 7 ? sha384 : sha512;
  const scheme =
    ed === ed25519
      ? 0x0807
      : ed === ed448
        ? 0x0808
        : id === 2
          ? 0x0403
          : id === 5
            ? 0x0603
            : 0x0503;
  const signature: Signature = {
    async verify(key, message, sig) {
      if (ed) {
        if (key.length !== (ed === ed25519 ? 32 : 57)) return false;
      } else {
        if (
          key.length !== (id === 2 ? 65 : id === 5 ? 133 : 97) ||
          key[0] !== 4
        )
          return false;
        ec.Point.fromBytes(key).assertValidity();
      }
      return ed
        ? ed.verify(sig, message, key, { zip215: false })
        : ec.verify(sig, message, key, {
            prehash: true,
            format: "der",
            lowS: false,
          });
    },
    async sign(key, message) {
      return ed
        ? ed.sign(message, key)
        : ec.sign(message, key, { prehash: true, format: "der", lowS: false });
    },
    async keygen() {
      const curve = ed ?? ec;
      const signKey = curve.utils.randomSecretKey();
      return {
        signKey,
        publicKey: ed
          ? ed.getPublicKey(signKey)
          : ec.getPublicKey(signKey, false),
      };
    },
  };
  const hash: Hash = {
    async digest(data) {
      return digest(data);
    },
    async mac(key, data) {
      return hmac(digest, key, data);
    },
    async verifyMac(key, mac, data) {
      return equalBytes(mac, hmac(digest, key, data));
    },
  };
  return {
    scheme,
    signature,
    hash,
    validateEncryptionKey(key: Uint8Array) {
      if (ed) {
        const curve = ed === ed25519 ? x25519 : x448;
        // A public, fixed probe scalar detects low-order/unusable public keys.
        // This derives no recipient secret and performs no decryption.
        curve.getSharedSecret(
          new Uint8Array(ed === ed25519 ? 32 : 56).fill(7),
          key,
        );
      } else {
        const length = id === 2 ? 65 : id === 5 ? 133 : 97;
        if (key.length !== length || key[0] !== 4)
          throw new Error("Expected an uncompressed HPKE curve point");
        ec.Point.fromBytes(key).assertValidity();
      }
    },
  };
}
