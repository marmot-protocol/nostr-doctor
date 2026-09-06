import type { SectionOutcome } from "./accordion-types.ts";
import type { KeyPackagesState } from "./key-packages/loader.ts";
import type { KeyPackageRelayListState } from "./key-package-relays/loader.ts";

export function keyPackageOutcome(state: KeyPackagesState): SectionOutcome {
  const verified = state.currentPackages.filter((pkg) => pkg.selected);
  const broken = state.currentPackages.filter((pkg) =>
    ["malformed", "unsupported-mls", "invalid-mls", "relay-expired"].includes(
      pkg.status,
    ),
  );
  const unverified = state.currentPackages.some(
    (pkg) => !pkg.mls || pkg.mls.status === "unverified",
  );
  if (broken.length && !verified.length)
    return {
      status: "error",
      summary: `No verified candidate; ${broken.length} invalid or expired publication(s)`,
    };
  if (!state.currentPackages.length)
    return {
      status: state.incompleteRelays.length ? "warning" : "notfound",
      summary:
        "No current KeyPackages observed; open your Marmot client to publish one",
    };
  if (!verified.length)
    return {
      status: "warning",
      summary: unverified
        ? "No verified candidate yet; some MLS checks remain unvalidated"
        : "No active public KeyPackage candidate; refresh it in your Marmot client",
    };
  const improvements =
    broken.length > 0 ||
    unverified ||
    state.incompleteRelays.length > 0 ||
    !state.nip65WriteRelays.length ||
    verified.some(
      (pkg) =>
        pkg.status !== "valid" ||
        pkg.mls?.checks.some((check) => check.status !== "pass"),
    );
  return {
    status: improvements ? "warning" : "clean",
    summary: `${verified.length} public KeyPackage candidate(s) verified${improvements ? "; improvements or incomplete checks remain" : "; client possession and delivery are not tested"}`,
  };
}

export function marmotRelayOutcome(
  state: KeyPackageRelayListState,
): SectionOutcome {
  if (state.invalidWriteUrls.length || state.invalidInboxUrls.length)
    return { status: "error", summary: "Relay lists contain invalid URLs" };
  if (!state.discoveryComplete)
    return {
      status: "warning",
      summary: "Current Marmot relay discovery is incomplete",
    };
  if (
    state.currentInboxRelayUrls === null ||
    state.currentInboxRelayUrls?.length === 0
  )
    return {
      status: "notfound",
      summary: "No current inbox relays discovered",
    };
  if (
    !state.nip65WriteRelays.length ||
    state.currentInboxRelayUrls === undefined
  )
    return {
      status: "warning",
      summary: "Current Marmot relay discovery is incomplete",
    };
  const uncertainWrites = state.nip65WriteRelays.some((url) => {
    const relay = state.writeRelays[url];
    return (
      !relay ||
      relay.verdict !== "online" ||
      relay.deleteSupport !== "advertised"
    );
  });
  const uncertainInboxes = state.currentInboxRelayUrls.some((url) => {
    const relay = state.currentRelays[url];
    return (
      !relay ||
      relay.verdict !== "online" ||
      relay.invalidEvents > 0 ||
      relay.giftWrapRetrieval === "error" ||
      relay.giftWrapRetrieval === "unknown"
    );
  });
  return uncertainWrites || uncertainInboxes
    ? {
        status: "warning",
        summary:
          "Some relay observations are inconclusive; inspect the details",
      }
    : {
        status: "clean",
        summary:
          "Public relay checks complete; end-to-end delivery is not tested",
      };
}
