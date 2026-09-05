import { useEffect, useMemo, useState } from "react";
import { pool } from "../../../lib/relay.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { KeyPackageRelayListState, RelayDiagnostic } from "./loader.ts";

function RelayRow({
  relayUrl,
  diagnostic,
}: {
  relayUrl: string;
  diagnostic: RelayDiagnostic;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  return (
    <div className="rounded-lg border border-base-200 p-3 flex flex-col gap-2">
      <p className="font-mono text-xs break-all" title={relay.url}>
        {relayUrl}
      </p>
      <div className="flex flex-wrap gap-1">
        <span
          className={`badge badge-sm ${diagnostic.verdict === "online" ? "badge-success" : diagnostic.verdict === "offline" ? "badge-error" : "badge-ghost"}`}
        >
          {diagnostic.verdict}
        </span>
        <span
          className={`badge badge-sm ${diagnostic.deleteSupport === "supported" ? "badge-success" : diagnostic.deleteSupport === "unsupported" ? "badge-warning" : "badge-ghost"}`}
        >
          NIP-09 {diagnostic.deleteSupport}
        </span>
        <span
          className={`badge badge-sm ${diagnostic.welcomeReachability === "error" ? "badge-error" : "badge-info"}`}
        >
          Welcome {diagnostic.welcomeReachability}
        </span>
      </div>
      <p className="text-xs text-base-content/50">
        {diagnostic.welcomeCount === 0
          ? "No kind 1059 Welcome events were observed for this account."
          : `${diagnostic.welcomeCount} encrypted kind 1059 Welcome event${diagnostic.welcomeCount === 1 ? "" : "s"} observed.`}{" "}
        Encrypted event content is never displayed.
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
  const legacyUrls = useMemo(
    () => state?.legacyRelayUrls ?? [],
    [state?.legacyRelayUrls],
  );
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (isLoading || reported) return;
    setReported(true);
    const failed = currentUrls.filter((url) => {
      const diagnostic = state?.currentRelays[url];
      return (
        !diagnostic ||
        diagnostic.verdict !== "online" ||
        diagnostic.deleteSupport !== "supported" ||
        diagnostic.welcomeReachability === "error"
      );
    }).length;
    if (state?.currentInboxRelayUrls === null) {
      onDone({
        status: "notfound",
        summary: "No current kind 10050 inbox relay list found",
      });
    } else if (failed > 0) {
      onDone({
        status: "error",
        summary: `${failed} current inbox relay issue${failed === 1 ? "" : "s"}`,
      });
    } else {
      onDone({
        status: "clean",
        summary: `${currentUrls.length} current inbox relay${currentUrls.length === 1 ? "" : "s"} checked`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-4">
        <span className="loading loading-spinner loading-sm text-primary" />
        <p className="text-sm text-base-content/60">
          Discovering NIP-65 and inbox relays, then checking optional Welcome
          reachability…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-semibold">Current Marmot relay discovery</h3>
          <p className="text-xs text-base-content/60">
            Kind 30443 KeyPackages use NIP-65 write relays. Kind 1059 Welcome
            events use the recipient&apos;s kind 10050 inbox relays.
          </p>
        </div>
        <div className="rounded-xl bg-base-200/60 p-3 text-xs">
          <span className="font-medium">NIP-65 write relays: </span>
          {(state?.nip65WriteRelays.length ?? 0) > 0
            ? state?.nip65WriteRelays.join(", ")
            : "none discovered"}
        </div>
        {state?.currentInboxRelayUrls === null ? (
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
              diagnostic={state!.currentRelays[url]}
            />
          ))
        )}
        <p className="text-xs text-base-content/50">
          NIP-09 support indicates whether a relay advertises deletion support;
          current KeyPackage deletion events themselves are kind 5.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-base-200 pt-4">
        <div>
          <h3 className="font-semibold">Legacy migration diagnostics</h3>
          <p className="text-xs text-base-content/60">
            Legacy kind 10051 KeyPackage relays are shown separately and do not
            determine current Marmot health.
          </p>
        </div>
        {state?.legacyRelayUrls === null ? (
          <p className="text-sm text-base-content/50">
            No legacy kind 10051 relay list found.
          </p>
        ) : legacyUrls.length === 0 ? (
          <p className="text-sm text-base-content/50">
            Legacy kind 10051 relay list is empty.
          </p>
        ) : (
          legacyUrls.map((url) => (
            <div
              key={url}
              className="flex justify-between gap-2 rounded-lg border border-base-200 p-3 text-xs"
            >
              <span className="font-mono break-all">{url}</span>
              <span className="badge badge-ghost badge-xs">
                {state?.legacyVerdicts[url] ?? "unknown"}
              </span>
            </div>
          ))
        )}
      </section>

      {!isDoneSection && (
        <button className="btn btn-primary btn-sm w-full" onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  );
}

export default ReportContent;
