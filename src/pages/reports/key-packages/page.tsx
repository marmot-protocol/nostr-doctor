import { useEffect, useMemo, useState } from "react";
import { setDeleteEvents } from "applesauce-core/operations/delete";
import { factory } from "../../../lib/factory.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { KeyPackage, KeyPackagesState } from "./loader.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// TrashIcon
// ---------------------------------------------------------------------------

function TrashIcon() {
  return (
    <svg
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// KeyPackageCard
// ---------------------------------------------------------------------------

function KeyPackageCard({
  pkg,
  onDelete,
  deleteState,
}: {
  pkg: KeyPackage;
  onDelete: (pkg: KeyPackage) => void;
  deleteState: "idle" | "pending" | "done" | "error";
}) {
  const [expanded, setExpanded] = useState(false);

  const label = pkg.device ?? pkg.client ?? null;
  const sublabel = pkg.device && pkg.client ? pkg.client : null;
  const isDeleted = deleteState === "done";
  const isQueued = deleteState === "pending";

  return (
    <div
      className={[
        "rounded-xl border overflow-hidden transition-opacity duration-200",
        isDeleted
          ? "border-base-200 bg-base-200/40 opacity-50"
          : "border-base-200 bg-base-100",
      ].join(" ")}
    >
      <div className="p-4 flex items-start gap-3">
        {/* Icon */}
        <div
          className={[
            "size-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
            isDeleted ? "bg-base-200" : "bg-primary/10",
          ].join(" ")}
        >
          <svg
            className={["size-5", isDeleted ? "text-base-content/30" : "text-primary"].join(" ")}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
            />
          </svg>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              {label ? (
                <p className={["text-sm font-semibold truncate", isDeleted ? "line-through text-base-content/40" : "text-base-content"].join(" ")}>
                  {label}
                </p>
              ) : (
                <p className="text-sm font-semibold text-base-content/50 font-mono">
                  {shortId(pkg.id)}
                </p>
              )}
              {sublabel && (
                <p className="text-xs text-base-content/50">{sublabel}</p>
              )}
            </div>
            <span className="text-xs text-base-content/40 shrink-0 tabular-nums">
              {formatRelativeTime(pkg.createdAt)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mt-0.5">
            {pkg.client && (
              <span className="badge badge-ghost badge-xs">{pkg.client}</span>
            )}
            {pkg.foundOnRelay && (
              <span
                className="badge badge-ghost badge-xs font-mono truncate max-w-[180px]"
                title={pkg.foundOnRelay}
              >
                {new URL(pkg.foundOnRelay).hostname}
              </span>
            )}
            {isQueued && (
              <span className="badge badge-warning badge-xs">queued</span>
            )}
            {isDeleted && (
              <span className="badge badge-error badge-xs">deleted</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {/* Trash toggle — queues/dequeues for batch deletion */}
          {!isDeleted && (
            <button
              className={[
                "btn btn-ghost btn-xs",
                isQueued ? "text-error bg-error/10" : "text-base-content/30 hover:text-error hover:bg-error/10",
              ].join(" ")}
              onClick={() => onDelete(pkg)}
              aria-label={isQueued ? "Remove from deletion queue" : "Queue for deletion"}
              title={isQueued ? "Click to deselect" : "Queue for deletion"}
            >
              <TrashIcon />
            </button>
          )}

          {/* Expand toggle */}
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            <svg
              className={[
                "size-4 transition-transform duration-150",
                expanded ? "rotate-180" : "",
              ].join(" ")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-base-200 px-4 py-3 flex flex-col gap-2 bg-base-200/40">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-base-content/40 uppercase tracking-wide font-medium">
              Event ID
            </span>
            <span className="font-mono text-xs text-base-content/70 break-all">
              {pkg.id}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-base-content/40 uppercase tracking-wide font-medium">
              Created
            </span>
            <span className="text-xs text-base-content/70">
              {new Date(pkg.createdAt * 1000).toLocaleString()}
            </span>
          </div>
          {pkg.foundOnRelay && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-base-content/40 uppercase tracking-wide font-medium">
                Found on relay
              </span>
              <span className="font-mono text-xs text-base-content/70 break-all">
                {pkg.foundOnRelay}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-base-content/40 uppercase tracking-wide font-medium">
              Tags
            </span>
            <div className="flex flex-wrap gap-1">
              {pkg.event.tags.map((tag, i) => (
                <span
                  key={i}
                  className="badge badge-ghost badge-xs font-mono"
                  title={tag.join(" ")}
                >
                  {tag[0]}
                  {tag[1]
                    ? `=${tag[1].slice(0, 16)}${tag[1].length > 16 ? "…" : ""}`
                    : ""}
                </span>
              ))}
              {pkg.event.tags.length === 0 && (
                <span className="text-xs text-base-content/40">none</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ hasRelays }: { hasRelays: boolean }) {
  return (
    <div className="rounded-xl border border-base-200 bg-base-200/40 p-6 text-center flex flex-col items-center gap-2">
      <svg
        className="size-8 text-base-content/20"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
        />
      </svg>
      <p className="text-sm text-base-content/50">
        {hasRelays
          ? "No key packages found on your key package relays."
          : "No key packages found on any connected relay."}
      </p>
      <p className="text-xs text-base-content/30">
        Key packages are published by MLS-compatible Nostr clients when you set
        up encrypted group messaging.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportContent
// ---------------------------------------------------------------------------

export function ReportContent({
  account,
  publish: publishEvent,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<KeyPackagesState>) {
  const isReadOnly = account === null;
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const packages = useMemo(() => state?.packages ?? [], [state?.packages]);
  const keyPackageRelays = state?.keyPackageRelays ?? null;

  // Set of package IDs the user has toggled for deletion
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  // "idle" | "publishing" | "done" | "error"
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "done" | "error">("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  // IDs that were successfully deleted (to show strikethrough after done)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (!isLoading && !reported) {
      setReported(true);
      if (packages.length === 0) {
        onDone({ status: "notfound", summary: "No key packages found" });
      } else {
        onDone({
          status: "clean",
          summary: `${packages.length} key package${packages.length !== 1 ? "s" : ""} found`,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  function handleToggleQueue(pkg: KeyPackage) {
    setQueuedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pkg.id)) next.delete(pkg.id);
      else next.add(pkg.id);
      return next;
    });
  }

  async function handlePublishDeletions() {
    const toDelete = packages.filter((p) => queuedIds.has(p.id) && !deletedIds.has(p.id));
    if (toDelete.length === 0) return;

    setPublishState("publishing");
    setPublishError(null);
    try {
      // Build a single NIP-09 kind:5 event referencing all queued event IDs
      const draft = await factory.build(
        { kind: 5 },
        setDeleteEvents(toDelete.map((p) => p.event)),
      );
      await publishEvent(draft);
      setDeletedIds((prev) => new Set([...prev, ...toDelete.map((p) => p.id)]));
      setQueuedIds(new Set());
      setPublishState("done");
    } catch (e) {
      setPublishState("error");
      setPublishError(e instanceof Error ? e.message : "Failed to publish deletions.");
    }
  }

  // Derive per-card delete state from the batched state
  function deleteStateFor(id: string): "idle" | "pending" | "done" | "error" {
    if (deletedIds.has(id)) return "done";
    if (publishState === "publishing" && queuedIds.has(id)) return "pending";
    return "idle";
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            {packages.length > 0
              ? `Found ${packages.length} key package${packages.length !== 1 ? "s" : ""}…`
              : "Searching for key packages…"}
          </p>
        </div>
        {packages.length > 0 && (
          <div className="flex flex-col gap-3">
            {packages.map((pkg) => (
              <KeyPackageCard
                key={pkg.id}
                pkg={pkg}
                onDelete={handleToggleQueue}
                deleteState={queuedIds.has(pkg.id) ? "pending" : deleteStateFor(pkg.id)}
              />
            ))}
          </div>
        )}
        {!isDoneSection && (
          <button
            className="btn btn-ghost btn-sm w-full"
            onClick={() => {
              onDone({ status: "skipped", summary: "Skipped" });
              onContinue();
            }}
          >
            Skip
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {/* Relay context banner */}
      {keyPackageRelays !== null && (
        <div className="bg-base-200/60 rounded-xl p-3 flex flex-wrap gap-1 items-center">
          <span className="text-xs text-base-content/50 mr-1">
            Searched key package relays:
          </span>
          {keyPackageRelays.map((url) => {
            let hostname = url;
            try {
              hostname = new URL(url).hostname;
            } catch {
              // keep raw
            }
            return (
              <span key={url} className="badge badge-ghost badge-xs font-mono">
                {hostname}
              </span>
            );
          })}
        </div>
      )}

      {/* Read-only notice */}
      {isReadOnly && packages.length > 0 && (
        <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
          You're viewing someone else's account. Deletions will be queued as
          drafts and need signing at the end.
        </div>
      )}

      {/* Summary line */}
      {packages.length > 0 ? (
        <div className="flex items-center gap-2 text-success">
          <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm font-medium">
            {packages.length} key package{packages.length !== 1 ? "s" : ""} found
            {deletedIds.size > 0 && (
              <span className="text-base-content/50 font-normal">
                {" "}· {deletedIds.size} deleted
              </span>
            )}
          </p>
        </div>
      ) : (
        <EmptyState hasRelays={keyPackageRelays !== null} />
      )}

      {/* Package cards */}
      {packages.length > 0 && (
        <div className="flex flex-col gap-3">
          {packages.map((pkg) => (
            <KeyPackageCard
              key={pkg.id}
              pkg={pkg}
              onDelete={handleToggleQueue}
              deleteState={deletedIds.has(pkg.id) ? "done" : queuedIds.has(pkg.id) ? "pending" : "idle"}
            />
          ))}
        </div>
      )}

      {/* Batch delete action */}
      {queuedIds.size > 0 && publishState !== "done" && (
        <div className="flex flex-col gap-2">
          <button
            className="btn btn-error btn-sm w-full"
            onClick={handlePublishDeletions}
            disabled={publishState === "publishing"}
          >
            {publishState === "publishing" ? (
              <><span className="loading loading-spinner loading-xs" /> Deleting…</>
            ) : (
              `Delete ${queuedIds.size} selected key package${queuedIds.size !== 1 ? "s" : ""}`
            )}
          </button>
          <p className="text-xs text-base-content/40 text-center">
            This will publish a single NIP-09 deletion event for all selected packages.
          </p>
        </div>
      )}

      {publishError && (
        <p className="text-xs text-error">{publishError}</p>
      )}

      {!isDoneSection && (
        <button className="btn btn-primary btn-sm w-full" onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  );
}

export default ReportContent;
