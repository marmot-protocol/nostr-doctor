import { useEffect, useMemo, useState } from "react";
import { buildKeyPackageDeletion } from "../../../lib/marmot/key-package-deletion.ts";
import { keyPackageOutcome } from "../marmot-outcomes.ts";
import type { CurrentKeyPackage } from "../marmot-diagnostics.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { KeyPackagesState } from "./loader.ts";
import type {
  KeyPackageValidation,
  ValidationCheck,
} from "../../../lib/marmot/key-package-validation.ts";

function CheckRow({ check }: { check: ValidationCheck }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`badge badge-xs ${check.status === "pass" ? "badge-success" : check.status === "fail" ? "badge-error" : "badge-warning"}`}
        >
          {check.status === "pass"
            ? "Passed"
            : check.status === "fail"
              ? "Failed"
              : check.status === "warning"
                ? "Improve"
                : "Not verified"}
        </span>
        <span className="font-medium">{check.label}</span>
      </div>
      <p className="text-base-content/70">{check.detail}</p>
      {check.remedy && <p className="text-base-content/60">{check.remedy}</p>}
    </li>
  );
}

function ValidationDetails({
  validation,
}: {
  validation: KeyPackageValidation | undefined;
}) {
  if (!validation)
    return (
      <p className="text-xs text-warning">
        Decoded validation is pending or did not finish before the report
        deadline. Retry to complete it.
      </p>
    );
  const issues = validation.checks.filter((check) => check.status !== "pass");
  const passed = validation.checks.filter((check) => check.status === "pass");
  return (
    <div className="text-xs">
      {issues.length > 0 && (
        <ul className="divide-y divide-base-200">
          {issues.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer font-medium text-success">
          {passed.length} public checks passed — details
        </summary>
        <ul className="divide-y divide-base-200">
          {passed.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </details>
    </div>
  );
}

function statusClass(status: CurrentKeyPackage["status"]): string {
  if (status === "valid") return "badge-success";
  if (
    status === "unvalidated-mls" ||
    status === "deletion-requested" ||
    status === "relay-expired"
  )
    return "badge-warning";
  if (
    status === "partial-relay" ||
    status === "relay-unverified" ||
    status === "unsupported-mls"
  )
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
          <p className="text-sm font-semibold truncate">Publication slot</p>
          <p className="font-mono text-xs text-base-content/60 break-all">
            {pkg.publicationSlot}
          </p>
        </div>
        <span className={`badge badge-sm ${statusClass(pkg.status)}`}>
          {pkg.status.replaceAll("-", " ")}
        </span>
      </div>
      <p className="text-xs text-base-content/60">{pkg.detail}</p>
      {pkg.selected && (
        <p className="text-xs text-success">
          Newest verified candidate in this publication slot.
        </p>
      )}
      {!pkg.selected && pkg.status === "valid" && (
        <p className="text-xs text-base-content/60">
          An older valid revision; a newer verified candidate exists in this
          slot.
        </p>
      )}
      <ValidationDetails validation={pkg.mls} />
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
        {pkg.uncheckedRelays.length > 0 && (
          <>
            <dt className="text-base-content/40">Unverified</dt>
            <dd className="break-all">{pkg.uncheckedRelays.join(", ")}</dd>
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
        disabled={pkg.status === "deletion-requested"}
      >
        {pkg.status === "deletion-requested"
          ? "Deletion requested"
          : queued
            ? "Deletion queued"
            : "Queue kind 5 deletion"}
      </button>
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
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (isLoading || reported) return;
    setReported(true);
    if (state) onDone(keyPackageOutcome(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleContinue() {
    setError(null);
    setPublishing(true);
    try {
      const toDelete = currentPackages.filter((pkg) => queuedIds.has(pkg.id));
      if (toDelete.length > 0) {
        const draft = await buildKeyPackageDeletion(
          toDelete.map((pkg) => pkg.id),
        );
        await publish(draft);
      }
      onContinue();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not submit deletion requests.",
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      {isLoading && (
        <div className="flex items-center gap-3 py-4">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            Checking Marmot KeyPackages…
          </p>
        </div>
      )}
      {!isLoading && (state?.incompleteRelays.length ?? 0) > 0 && (
        <p className="alert alert-warning text-sm">
          Some relay requests failed or did not finish. Observed packages are
          shown below; absence on those relays is unverified.
        </p>
      )}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-semibold">Current Marmot</h3>
          <p className="text-xs text-base-content/60">
            Public kind 30443 KeyPackages are decoded and checked below. Each
            slot selects its newest verified candidate; invalid and older
            publications remain visible. A slot does not identify a device.
          </p>
        </div>
        {(state?.nip65WriteRelays.length ?? 0) === 0 && (
          <div className="alert alert-warning text-sm">
            No NIP-65 write relays were discovered; lookup relays were searched,
            but relay completeness cannot be established.
          </div>
        )}
        <div className="alert alert-info text-xs">
          These checks verify public invitation material. They cannot prove the
          recipient still holds its private keys, can process a Welcome, or
          supports every feature required by a particular group.
        </div>
        {currentPackages.length === 0 ? (
          <p className="rounded-xl bg-base-200/60 p-4 text-sm text-base-content/60">
            {isLoading
              ? "Searching for current kind 30443 KeyPackages…"
              : (state?.incompleteRelays.length ?? 0) > 0
                ? "No current KeyPackages observed before the search ended."
                : "No current kind 30443 KeyPackages found."}
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

      {error && <p className="text-error text-sm">{error}</p>}
      {!isDoneSection && !isLoading && queuedIds.size > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={onContinue}>
          Skip deletions
        </button>
      )}
      {!isDoneSection && (
        <button
          className="btn btn-primary btn-sm w-full"
          disabled={publishing}
          onClick={() => {
            if (isLoading) {
              setReported(true);
              onDone({ status: "skipped", summary: "Skipped" });
              onContinue();
            } else void handleContinue();
          }}
        >
          {isLoading
            ? "Skip"
            : publishing
              ? "Submitting…"
              : queuedIds.size
                ? `Request ${queuedIds.size} deletion(s) & Continue`
                : "Continue"}
        </button>
      )}
    </div>
  );
}

export default ReportContent;
