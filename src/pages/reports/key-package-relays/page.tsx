import { useEffect, useMemo, useState } from "react";
import { marmotRelayOutcome } from "../marmot-outcomes.ts";
import type { SectionProps } from "../accordion-types.ts";
import {
  UNKNOWN_DIAGNOSTIC,
  type KeyPackageRelayListState,
  type RelayDiagnostic,
} from "./loader.ts";

function RelayRow({
  relayUrl,
  diagnostic,
}: {
  relayUrl: string;
  diagnostic: RelayDiagnostic;
}) {
  return (
    <div className="rounded-lg border border-base-200 p-3 flex flex-col gap-2">
      <p className="font-mono text-xs break-all" title={relayUrl}>
        {relayUrl}
      </p>
      <div className="flex flex-wrap gap-1">
        <span
          className={`badge badge-sm ${diagnostic.verdict === "online" ? "badge-success" : diagnostic.verdict === "offline" ? "badge-error" : "badge-ghost"}`}
        >
          Monitor: {diagnostic.verdict}
        </span>
        <span
          className={`badge badge-sm ${diagnostic.giftWrapRetrieval === "error" ? "badge-error" : "badge-info"}`}
        >
          Gift-wrap retrieval: {diagnostic.giftWrapRetrieval}
        </span>
      </div>
      <p className="text-xs text-base-content/50">
        {diagnostic.giftWrapCount > 0
          ? `${diagnostic.giftWrapCount} encrypted kind 1059 gift wrap(s) observed.`
          : diagnostic.giftWrapRetrieval === "empty"
            ? "The request completed without any kind 1059 gift wraps."
            : "Gift-wrap retrieval could not be established."}{" "}
        {diagnostic.giftWrapRetrieval === "auth-required" &&
          "This relay requires recipient authentication, as recommended for inbox privacy. This is not a delivery failure. "}
        {diagnostic.invalidEvents > 0 &&
          "Invalid or unrelated relay responses were ignored. "}
        Gift wraps may contain private messages or Marmot Welcomes; their
        encrypted contents are not inspected.
      </p>
    </div>
  );
}

export function ReportContent({
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<KeyPackageRelayListState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;
  const currentUrls = useMemo(
    () => state?.currentInboxRelayUrls ?? [],
    [state?.currentInboxRelayUrls],
  );
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (isLoading || reported) return;
    setReported(true);
    if (state) onDone(marmotRelayOutcome(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <div className="flex flex-col gap-5 py-2">
      {isLoading && (
        <div className="flex items-center gap-3 py-4">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            Discovering relays and checking gift-wrap retrieval…
          </p>
        </div>
      )}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-semibold">Current Marmot relay discovery</h3>
          <p className="text-xs text-base-content/60">
            Kind 30443 KeyPackages use NIP-65 write relays. Kind 1059 Welcome
            events use the recipient&apos;s kind 10050 inbox relays.
          </p>
        </div>
        <h4 className="text-sm font-semibold">
          KeyPackage publication relays (NIP-65 writes)
        </h4>
        {!isLoading && !state?.discoveryComplete && (
          <p className="alert alert-warning text-sm">
            Relay-list discovery was incomplete or included invalid responses.
            The signed lists observed so far are shown below.
          </p>
        )}
        {(state?.nip65WriteRelays ?? []).length === 0 && (
          <p className="text-sm text-warning">
            No write-capable NIP-65 relays discovered.
          </p>
        )}
        {(state?.nip65WriteRelays ?? []).map((url) => (
          <div
            key={url}
            className="rounded-lg border border-base-200 p-3 text-xs flex flex-col gap-2"
          >
            <span className="font-mono break-all">{url}</span>
            <span>
              Monitor: {state?.writeRelays[url]?.verdict ?? "unknown"} · NIP-09:{" "}
              {state?.writeRelays[url]?.deleteSupport ?? "unknown"}
            </span>
          </div>
        ))}
        <p className="text-xs text-base-content/50">
          NIP-09 is a relay advertisement, not proof of deletion. Read-only
          checks do not test publishing. Monitor reports may be stale.
        </p>
        <h4 className="text-sm font-semibold">
          Welcome inbox relays (kind 10050)
        </h4>
        {state?.currentInboxRelayUrls === undefined ? (
          <p className="text-sm text-base-content/60">
            {isLoading
              ? "Discovering current inbox relays…"
              : "Current inbox relay discovery did not complete."}
          </p>
        ) : state.currentInboxRelayUrls === null ? (
          <p className="rounded-xl bg-warning/10 p-4 text-sm">
            No current kind 10050 inbox relay list was found.
          </p>
        ) : currentUrls.length === 0 ? (
          <p className="rounded-xl bg-warning/10 p-4 text-sm">
            The current kind 10050 inbox relay list is empty.
          </p>
        ) : (
          currentUrls.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              diagnostic={state?.currentRelays[url] ?? UNKNOWN_DIAGNOSTIC}
            />
          ))
        )}
        {(state?.invalidWriteUrls.length ?? 0) +
          (state?.invalidInboxUrls.length ?? 0) >
          0 && (
          <p className="alert alert-error text-sm">
            Invalid relay URLs were excluded:{" "}
            {[
              ...(state?.invalidWriteUrls ?? []),
              ...(state?.invalidInboxUrls ?? []),
            ]
              .map((url) => url || "(empty URL)")
              .join(", ")}
          </p>
        )}
        <p className="text-xs text-base-content/50">
          Gift-wrap reads do not test Welcome decryption, acceptance, or future
          delivery.
        </p>
      </section>

      {!isDoneSection && (
        <button
          className="btn btn-primary btn-sm w-full"
          onClick={() => {
            if (isLoading) {
              setReported(true);
              onDone({ status: "skipped", summary: "Skipped" });
            }
            onContinue();
          }}
        >
          {isLoading ? "Skip" : "Continue"}
        </button>
      )}
    </div>
  );
}

export default ReportContent;
