import { describe, expect, it } from "vitest";
import { finalizeEvent } from "applesauce-core/helpers";
import {
  validatePublicKeyPackage,
  MAX_KEY_PACKAGE_LIFETIME_SECONDS,
} from "../key-package-validation.ts";
import {
  fixture,
  NOW,
  ACCOUNT,
  ACCOUNT_SECRET,
  dictionary,
  componentIds,
  extension,
  COMPONENTS,
} from "./fixtures.ts";
import { summarizeCurrentPackages } from "../../../pages/reports/marmot-diagnostics.ts";

const validate = async (options: Parameters<typeof fixture>[0] = {}) => {
  const f = await fixture(options);
  return validatePublicKeyPackage(f.event, ACCOUNT, NOW);
};
const failed = (result: Awaited<ReturnType<typeof validate>>) =>
  result.checks.filter((c) => c.status === "fail").map((c) => c.id);
const omitUpstreamComponent = (tags: string[][]) =>
  tags.map((tag) =>
    tag[0] === "app_components" ? tag.filter((id) => id !== "0x0001") : tag,
  );

describe("public Marmot MLS validation", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])(
    "validates signed current-profile packages using suite %i",
    async (suite) => {
      const result = await validate({ suite });
      expect(failed(result)).toEqual([]);
      expect(result.status).toBe("valid");
      expect(result.checks.every((c) => c.status === "pass")).toBe(true);
      expect(result.components).toEqual(COMPONENTS);
    },
  );
  it("detects a broken outer MLS signature independently of the Nostr signature", async () => {
    const { event, bytes } = await fixture();
    bytes[bytes.length - 1] ^= 1;
    const changed = finalizeEvent(
      { ...event, content: btoa(String.fromCharCode(...bytes)) },
      ACCOUNT_SECRET,
    );
    const result = await validatePublicKeyPackage(changed, ACCOUNT, NOW);
    expect(failed(result)).toContain("package-signature");
    expect(failed(result)).toContain("reference");
    expect(failed(result)).not.toContain("nostr");
    expect(failed(result)).not.toContain("leaf-signature");
  });
  it("detects a broken leaf signature even when the package is re-signed", async () => {
    expect(
      failed(
        await validate({
          modifyPackage: (kp) => {
            kp.leafNode.signature[0] ^= 1;
          },
        }),
      ),
    ).toContain("leaf-signature");
  });
  it("detects a forged account proof inside correctly signed MLS", async () => {
    const result = await validate({
      proofMutation: (proof) => {
        proof[50] ^= 1;
      },
    });
    expect(failed(result)).toEqual(["account-proof"]);
  });
  it("accepts an old reusable proof without inventing an age limit", async () => {
    expect((await validate({ proofTime: 1 })).status).toBe("valid");
  });
  it("rejects another account's credential", async () => {
    expect(
      failed(
        await validate({
          modifyLeaf: (leaf) => {
            if ("identity" in leaf.credential)
              leaf.credential.identity = new Uint8Array(32).fill(9);
          },
        }),
      ),
    ).toContain("identity");
  });
  it.each([
    { notBefore: BigInt(NOW - 10), notAfter: BigInt(NOW - 1) },
    { notBefore: BigInt(NOW + 1), notAfter: BigInt(NOW + 10) },
    {
      notBefore: BigInt(NOW),
      notAfter: BigInt(NOW) + MAX_KEY_PACKAGE_LIFETIME_SECONDS + 1n,
    },
  ])("rejects invalid lifetime case %#", async (lifetime) => {
    expect(failed(await validate({ lifetime }))).toContain("lifetime");
  });
  it("accepts lifetime endpoints inclusively and flags near expiry", async () => {
    const result = await validate({
      lifetime: { notBefore: BigInt(NOW), notAfter: BigInt(NOW) },
    });
    expect(result.status).toBe("valid");
    expect(result.checks.find((c) => c.id === "renewal")?.status).toBe(
      "warning",
    );
  });
  it("rejects identical init/leaf encryption keys and low-order points", async () => {
    expect(
      failed(
        await validate({
          modifyPackage: (kp) => {
            kp.initKey = kp.leafNode.hpkePublicKey;
          },
        }),
      ),
    ).toContain("encryption-keys");
    expect(
      failed(
        await validate({
          modifyPackage: (kp) => {
            kp.initKey = new Uint8Array(32);
          },
        }),
      ),
    ).toContain("encryption-keys");
  });
  it("rejects absent proof data and duplicate component entries", async () => {
    for (const entries of [
      [[1, componentIds(COMPONENTS)]],
      [
        [1, componentIds(COMPONENTS)],
        [1, componentIds(COMPONENTS)],
      ],
    ] as [number, Uint8Array][][]) {
      const result = await validate({
        modifyLeaf: (leaf) => {
          leaf.extensions = [extension(6, dictionary(entries))];
        },
      });
      expect(result.status).toBe("invalid");
      expect(failed(result)).toContain("account-proof");
    }
  });
  it("rejects capability advertisements that differ from decoded capabilities", async () => {
    const result = await validate({
      modifyTags: (tags) =>
        tags.map((t) => (t[0] === "mls_extensions" ? [...t, "0xf2d1"] : t)),
    });
    expect(failed(result)).toEqual(["advertisements"]);
  });
  it("accepts Marmot component tags that omit upstream 0x0001 without changing signed support", async () => {
    const result = await validate({ modifyTags: omitUpstreamComponent });
    expect(result.status).toBe("valid");
    expect(failed(result)).toEqual([]);
    expect(result.components).toEqual(COMPONENTS);
    expect(result.checks.find((c) => c.id === "account-proof")?.status).toBe(
      "pass",
    );
  });
  it("validates advertised components without requiring every signed capability to be advertised", async () => {
    const result = await validate({
      modifyTags: (tags) =>
        tags.map((tag) =>
          tag[0] === "app_components" ? ["app_components", "0x8009"] : tag,
        ),
    });
    expect(result.status).toBe("valid");
    expect(result.components).toEqual(COMPONENTS);
  });
  it.each(["0x8001", "0x0002", "0xfafa"])(
    "rejects advertised component %s when absent from signed support",
    async (id) => {
      const result = await validate({
        modifyTags: (tags) =>
          omitUpstreamComponent(tags).map((tag) =>
            tag[0] === "app_components" ? [...tag, id] : tag,
          ),
      });
      expect(failed(result)).toEqual(["advertisements"]);
    },
  );
  it.each([
    [],
    [["app_components"]],
    [["app_components", "0x8003"]],
    [["app_components", "0x8009", "0x8009"]],
    [
      ["app_components", "0x8009"],
      ["app_components", "0x8003"],
    ],
    [["app_components", "0x8009", "0X8003"]],
  ])(
    "rejects missing proof advertisement or malformed component tags %#",
    async (...componentTags) => {
      const result = await validate({
        modifyTags: (tags) => [
          ...tags.filter((tag) => tag[0] !== "app_components"),
          ...componentTags,
        ],
      });
      expect(failed(result)).toEqual(["advertisements"]);
    },
  );
  it.each([1, 0x8009])("still requires signed component 0x%s", async (id) => {
    const result = await validate({
      components: COMPONENTS.filter((component) => component !== id),
      modifyTags: omitUpstreamComponent,
    });
    expect(failed(result)).toContain("components");
  });
  it("still verifies the identity proof when upstream 0x0001 is omitted from tags", async () => {
    const result = await validate({
      modifyTags: omitUpstreamComponent,
      proofMutation: (proof) => {
        proof[50] ^= 1;
      },
    });
    expect(failed(result)).toEqual(["account-proof"]);
  });
  it("still rejects default MLS capabilities when upstream 0x0001 is omitted from tags", async () => {
    const result = await validate({
      modifyTags: omitUpstreamComponent,
      modifyLeaf: (leaf) => {
        leaf.capabilities.extensions.unshift(3);
      },
    });
    expect(failed(result)).toEqual(["capabilities"]);
  });
  it("distinguishes optional group improvements from invalid baseline packages", async () => {
    const result = await validate({ components: [1, 0x8009] });
    expect(result.status).toBe("valid");
    expect(result.checks.find((c) => c.id === "group-support")?.status).toBe(
      "warning",
    );
  });
  it("recognizes a last-resort component in the KeyPackage dictionary", async () => {
    const result = await validate({ lastResort: true });
    expect(result.status).toBe("valid");
    expect(result.lastResort).toBe(true);
  });
  it("rejects trailing bytes and truncated data", async () => {
    const { event, bytes } = await fixture();
    for (const raw of [
      new Uint8Array([...bytes, 0]),
      bytes.subarray(0, bytes.length - 1),
    ]) {
      const modified = finalizeEvent(
        { ...event, content: btoa(String.fromCharCode(...raw)) },
        ACCOUNT_SECRET,
      );
      expect(
        failed(await validatePublicKeyPackage(modified, ACCOUNT, NOW)),
      ).toContain("framing");
    }
  });
  it("does not let a newer invalid publication mask an older valid slot", async () => {
    const { event } = await fixture();
    const invalid = finalizeEvent(
      { ...event, content: "AQIDBA==", created_at: NOW + 1 },
      ACCOUNT_SECRET,
    );
    const results = new Map([
      [event.id, await validatePublicKeyPackage(event, ACCOUNT, NOW)],
      [invalid.id, await validatePublicKeyPackage(invalid, ACCOUNT, NOW)],
    ]);
    const packages = summarizeCurrentPackages(
      [
        {
          relayUrl: "wss://example.com",
          events: [event, invalid],
          error: false,
          complete: true,
        },
      ],
      ["wss://example.com"],
      ACCOUNT,
      NOW,
      results,
    );
    expect(packages.find((p) => p.id === event.id)?.selected).toBe(true);
    expect(packages.find((p) => p.id === invalid.id)?.status).toBe(
      "invalid-mls",
    );
  });
});

// Published MLS Working Group vectors are independent of our fixture generator.
import vectors from "./rfc9420-vectors.json";
import {
  mlsMessageDecoder,
  verifyKeyPackage,
  verifyLeafNodeSignatureKeyPackage,
  makeKeyPackageRef,
} from "ts-mls/diagnostics";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { suiteCrypto } from "../crypto.ts";
describe("independent RFC 9420 vectors", () => {
  it.each(vectors.vectors)(
    "verifies MLS signatures and the Welcome's reference for suite $suite",
    async (vector) => {
      const decoded = mlsMessageDecoder(hexToBytes(vector.keyPackage), 0)!;
      expect(decoded[1]).toBe(vector.keyPackage.length / 2);
      expect(decoded[0].wireformat).toBe(5);
      if (decoded[0].wireformat !== 5) throw new Error("Wrong vector kind");
      const kp = decoded[0].keyPackage;
      const cs = suiteCrypto(vector.suite)!;
      expect(await verifyKeyPackage(kp, cs.signature)).toBe(true);
      expect(
        await verifyLeafNodeSignatureKeyPackage(kp.leafNode, cs.signature),
      ).toBe(true);
      expect(bytesToHex(await makeKeyPackageRef(kp, cs.hash))).toBe(
        vector.reference,
      );
      expect(() => cs.validateEncryptionKey(kp.initKey)).not.toThrow();
      expect(() =>
        cs.validateEncryptionKey(kp.leafNode.hpkePublicKey),
      ).not.toThrow();
    },
  );
});

import { fakeVerifyEvent } from "applesauce-core/helpers";
import { keyPackageOutcome } from "../../../pages/reports/marmot-outcomes.ts";
import { buildKeyPackageDeletion } from "../key-package-deletion.ts";
describe("diagnostic trust boundaries", () => {
  it("treats the decoded size limit as inconclusive, including base64 padding boundaries", async () => {
    const { event } = await fixture();
    for (const length of [65_537, 65_538, 65_539]) {
      const oversized = finalizeEvent(
        { ...event, content: btoa("\0".repeat(length)) },
        ACCOUNT_SECRET,
      );
      const result = await validatePublicKeyPackage(oversized, ACCOUNT, NOW);
      expect(result.status).toBe("unverified");
      expect(result.checks.at(-1)?.detail).toContain("64 KiB");
    }
  });
  it("compares capability advertisements as sets without inventing an MLS duplicate prohibition", async () => {
    const result = await validate({
      modifyLeaf: (leaf) => {
        leaf.capabilities.extensions.push(6);
      },
      modifyTags: (tags) =>
        tags.map((tag) =>
          tag[0] === "mls_extensions" ? [...new Set(tag)] : tag,
        ),
    });
    expect(result.status).toBe("valid");
  });
  it("does not trust a fake verification marker from an unsigned local draft", async () => {
    const { event } = await fixture();
    const forged = { ...event, sig: "0".repeat(128) };
    fakeVerifyEvent(forged);
    expect(
      failed(await validatePublicKeyPackage(forged, ACCOUNT, NOW)),
    ).toContain("nostr");
  });
  it("does not label an unknown future ciphersuite as valid or invalid cryptography", async () => {
    const result = await validate({
      modifyPackage: (kp) => {
        kp.cipherSuite = 0xfafa;
        kp.leafNode.capabilities.ciphersuites = [0xfafa];
      },
      modifyTags: (tags) =>
        tags.map((t) =>
          t[0] === "mls_ciphersuite" ? ["mls_ciphersuite", "0xfafa"] : t,
        ),
    });
    expect(result.status).toBe("unverified");
    expect(result.checks.find((c) => c.id === "cryptography")?.status).toBe(
      "unverified",
    );
  });
  it("rejects default MLS proposal types incorrectly listed as non-default capabilities", async () => {
    expect(
      failed(
        await validate({
          modifyLeaf: (leaf) => {
            leaf.capabilities.proposals = [1, 8];
          },
        }),
      ),
    ).toContain("capabilities");
  });
  it("rejects a last-resort marker with nonempty data", async () => {
    expect(
      failed(
        await validate({
          modifyPackage: (kp) => {
            kp.extensions = [extension(6, dictionary([[4, Uint8Array.of(1)]]))];
          },
        }),
      ),
    ).toContain("components");
  });
  it("keeps additional GREASE capabilities and dictionary entries extensible", async () => {
    const result = await validate({
      components: [...COMPONENTS, 0xfafa],
      modifyLeaf: (leaf) => {
        leaf.capabilities.extensions.push(0xfafa);
        leaf.extensions.push(extension(0xfafa, Uint8Array.of(0)));
      },
    });
    expect(result.status).toBe("valid");
  });
  it("reports successful public validation in the final section outcome", async () => {
    const { event } = await fixture({ modifyTags: omitUpstreamComponent });
    const mls = await validatePublicKeyPackage(event, ACCOUNT, NOW);
    const state = {
      nip65WriteRelays: ["wss://example.com"],
      currentQueryRelays: ["wss://example.com"],
      incompleteRelays: [],
      currentPackages: summarizeCurrentPackages(
        [
          {
            relayUrl: "wss://example.com",
            events: [event],
            error: false,
            complete: true,
          },
        ],
        ["wss://example.com"],
        ACCOUNT,
        NOW,
        new Map([[event.id, mls]]),
      ),
    };
    expect(keyPackageOutcome(state).status).toBe("clean");
    expect(keyPackageOutcome(state).summary).toContain(
      "public KeyPackage candidate(s) verified",
    );
  });
  it("requests deletion of an exact revision without deleting the whole slot", async () => {
    const { event } = await fixture();
    const deletion = await buildKeyPackageDeletion([event.id]);
    expect(deletion.tags.find((t) => t[0] === "e")?.[1]).toBe(event.id);
    expect(deletion.tags.some((t) => t[0] === "a")).toBe(false);
  });
});
