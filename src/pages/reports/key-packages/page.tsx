import { useEffect, useMemo, useState } from "react";
import { setDeleteEvents } from "applesauce-core/operations/delete";
import { factory } from "../../../lib/factory.ts";
import type {
  CurrentKeyPackage,
  LegacyKeyPackage,
} from "../marmot-diagnostics.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { KeyPackagesState } from "./loader.ts";

function statusClass(status: CurrentKeyPackage["status"]): string {
  if (status === "unvalidated-mls") return "badge-info";
  if (status === "partial-relay" || status === "unsupported-mls")
    return "badge-warning";
  return "badge-error";
}

function PackageCard({
  pkg,
  queued,
  onToggle,
}: {
  pkg: CurrentKeyPackage;
  queued: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">
            Publication slot / device candidate
          </p>
          <p className="font-mono text-xs text-base-content/60 break-all">
            {pkg.publicationSlot}
          </p>
        </div>
        <span className={`badge badge-sm ${statusClass(pkg.status)}`}>
          {pkg.status.replaceAll("-", " ")}
        </span>
      </div>
      <p className="text-xs text-base-content/60">{pkg.detail}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-base-content/40">Event</dt>
        <dd className="font-mono truncate" title={pkg.id}>
          {pkg.id}
        </dd>
        <dt className="text-base-content/40">Seen</dt>
        <dd>
          {pkg.foundOnRelays.length} relay
          {pkg.foundOnRelays.length === 1 ? "" : "s"}
        </dd>
        {pkg.missingFromRelays.length > 0 && (
          <>
            <dt className="text-base-content/40">Missing</dt>
            <dd className="break-all">{pkg.missingFromRelays.join(", ")}</dd>
          </>
        )}
        {pkg.client && (
          <>
            <dt className="text-base-content/40">Client claim</dt>
            <dd>{pkg.client}</dd>
          </>
        )}
      </dl>
      <button
        className={`btn btn-xs self-end ${queued ? "btn-warning" : "btn-ghost"}`}
        onClick={onToggle}
        disabled={pkg.status === "deleted"}
      >
        {pkg.status === "deleted"
          ? "Already deleted"
          : queued
            ? "Deletion queued"
            : "Queue kind 5 deletion"}
      </button>
    </div>
  );
}

function LegacyCard({ pkg }: { pkg: LegacyKeyPackage }) {
  return (
    <div className="rounded-lg border border-base-200 p-3 text-xs flex flex-col gap-1">
      <div className="flex justify-between gap-2">
        <span className="font-medium">Legacy event {pkg.id.slice(0, 8)}…</span>
        <span className="badge badge-ghost badge-xs">kind 443</span>
      </div>
      <p className="text-base-content/60">
        {pkg.deviceCandidate
          ? `Legacy device label/candidate: ${pkg.deviceCandidate}`
          : "No legacy device label"}
      </p>
      <p className="text-base-content/40">
        Seen on {pkg.foundOnRelays.length} relay
        {pkg.foundOnRelays.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function ReportContent({
  publish,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<KeyPackagesState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;
  const currentPackages = useMemo(
    () => state?.currentPackages ?? [],
    [state?.currentPackages],
  );
  const legacyPackages = useMemo(
    () => state?.legacyPackages ?? [],
    [state?.legacyPackages],
  );
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (isLoading || reported) return;
    setReported(true);
    const unhealthy = currentPackages.filter(
      (pkg) => pkg.status !== "unvalidated-mls",
    ).length;
    if (currentPackages.length === 0) {
      onDone({
        status: "notfound",
        summary: "No current kind 30443 KeyPackages found",
      });
    } else if (unhealthy > 0) {
      onDone({
        status: "error",
        summary: `${unhealthy} current KeyPackage issue${unhealthy === 1 ? "" : "s"}`,
      });
    } else {
      onDone({
        status: "clean",
        summary: `${currentPackages.length} current publication slot${currentPackages.length === 1 ? "" : "s"} found`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleContinue() {
    const toDelete = currentPackages.filter((pkg) => queuedIds.has(pkg.id));
    if (toDelete.length > 0) {
      const draft = await factory.build(
        { kind: 5 },
        setDeleteEvents(toDelete.map((pkg) => pkg.event)),
      );
      await publish(draft);
    }
    onContinue();
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-4">
        <span className="loading loading-spinner loading-sm text-primary" />
        <p className="text-sm text-base-content/60">
          Checking current and legacy Marmot KeyPackages…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-semibold">Current Marmot</h3>
          <p className="text-xs text-base-content/60">
            Kind 30443 addressable KeyPackages, collapsed by pubkey/kind/d. A d
            value is only a publication slot or device candidate, not an
            authenticated device.
          </p>
        </div>
        {(state?.nip65WriteRelays.length ?? 0) === 0 && (
          <div className="alert alert-warning text-sm">
            No NIP-65 write relays were discovered; lookup relays were searched,
            but relay completeness cannot be established.
          </div>
        )}
        <div className="alert alert-info text-xs">
          This build has no maintained shared MLS parser. It checks required
          metadata and base64 encoding, but reports otherwise plausible MLS
          bytes and their internal lifetime as not validated.
        </div>
        {currentPackages.length === 0 ? (
          <p className="rounded-xl bg-base-200/60 p-4 text-sm text-base-content/60">
            No current kind 30443 KeyPackages found.
          </p>
        ) : (
          currentPackages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              queued={queuedIds.has(pkg.id)}
              onToggle={() =>
                setQueuedIds((previous) => {
                  const next = new Set(previous);
                  if (next.has(pkg.id)) next.delete(pkg.id);
                  else next.add(pkg.id);
                  return next;
                })
              }
            />
          ))
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-base-200 pt-4">
        <div>
          <h3 className="font-semibold">Legacy migration diagnostics</h3>
          <p className="text-xs text-base-content/60">
            Legacy kind 443 packages discovered through the legacy kind 10051
            relay list. These results do not represent current Marmot health.
          </p>
        </div>
        {legacyPackages.length === 0 ? (
          <p className="text-sm text-base-content/50">
            No legacy kind 443 packages found.
          </p>
        ) : (
          legacyPackages.map((pkg) => <LegacyCard key={pkg.id} pkg={pkg} />)
        )}
      </section>

      {!isDoneSection && (
        <button
          className="btn btn-primary btn-sm w-full"
          onClick={handleContinue}
        >
          Continue
        </button>
      )}
    </div>
  );
}

export default ReportContent;
