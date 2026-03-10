import { useEffect, useMemo, useState } from "react";
import type { Relay } from "applesauce-relay";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { of, timeout } from "rxjs";
import { use$ } from "applesauce-react/hooks";
import { useReport } from "../../context/ReportContext.tsx";
import { eventStore } from "../../lib/store.ts";
import { factory } from "../../lib/factory.ts";
import { pool } from "../../lib/relay.ts";

/** ms to wait for kind:10007 before treating it as not found */
const SEARCH_RELAYS_LOAD_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// NIP-50 support check status per relay
// ---------------------------------------------------------------------------

type Nip50Status = "checking" | "supported" | "unsupported" | "unknown";

// ---------------------------------------------------------------------------
// useNip50Status — subscribes to a relay's supported$ and derives NIP-50 verdict
// ---------------------------------------------------------------------------

function useNip50Status(relay: Relay): Nip50Status {
  const supported = use$(relay.supported$);

  if (supported === undefined) return "checking";
  if (supported === null) return "unknown";
  if (supported.includes(50)) return "supported";
  return "unsupported";
}

// ---------------------------------------------------------------------------
// Nip50Badge — visual indicator for a relay's NIP-50 support
// ---------------------------------------------------------------------------

function Nip50Badge({ status }: { status: Nip50Status }) {
  if (status === "supported") {
    return <span className="badge badge-success badge-sm">NIP-50</span>;
  }
  if (status === "unsupported") {
    return <span className="badge badge-error badge-sm">No NIP-50</span>;
  }
  if (status === "unknown") {
    return <span className="badge badge-ghost badge-sm">Unknown</span>;
  }
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — one search relay with NIP-50 check and selection checkbox
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  relay,
  selected,
  onToggle,
}: {
  relayUrl: string;
  relay: Relay;
  selected: boolean;
  onToggle: (url: string) => void;
}) {
  const status = useNip50Status(relay);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isUnsupported = status === "unsupported";

  const name = info?.name ?? relayUrl;
  const description = info?.description;

  return (
    <label
      className={[
        "rounded-xl border p-4 flex items-start gap-3 cursor-pointer transition-colors select-none",
        isUnsupported
          ? selected
            ? "border-error/60 bg-error/10"
            : "border-error/30 bg-error/5"
          : "border-base-200",
        !isUnsupported && "cursor-default",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Checkbox — only interactive for unsupported relays */}
      {isUnsupported ? (
        <input
          type="checkbox"
          className="checkbox checkbox-error checkbox-sm mt-0.5 shrink-0"
          checked={selected}
          onChange={() => onToggle(relayUrl)}
        />
      ) : (
        <div className="size-4 mt-0.5 shrink-0" />
      )}

      {/* Icon */}
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="size-8 rounded-lg shrink-0 object-cover bg-base-200"
        />
      ) : (
        <div
          className="size-8 rounded-lg shrink-0 bg-base-200 flex items-center justify-center text-base-content/40 text-xs font-mono"
          aria-hidden
        >
          …
        </div>
      )}

      {/* Text */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-medium text-sm text-base-content truncate">
          {name}
        </span>
        <span className="font-mono text-xs text-base-content/60 break-all">
          {relayUrl}
        </span>
        {description != null && description !== "" && (
          <p className="text-xs text-base-content/70 line-clamp-2 mt-0.5">
            {description}
          </p>
        )}
      </div>

      {/* Badge */}
      <Nip50Badge status={status} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// StatusTracker — wrapper that reports NIP-50 status changes upward
// ---------------------------------------------------------------------------

function StatusTracker({
  relayUrl,
  relay,
  selected,
  onToggle,
  onStatus,
}: {
  relayUrl: string;
  relay: Relay;
  selected: boolean;
  onToggle: (url: string) => void;
  onStatus: (url: string, status: Nip50Status) => void;
}) {
  const status = useNip50Status(relay);

  useEffect(() => {
    onStatus(relayUrl, status);
  }, [relayUrl, status, onStatus]);

  return (
    <RelayRow
      relayUrl={relayUrl}
      relay={relay}
      selected={selected}
      onToggle={onToggle}
    />
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function SearchRelayNip50Report() {
  const { subject: subjectUser, next, publish: publishEvent } = useReport();

  // Load the user's kind:10007 search relay list.
  // Resolves to null after timeout if the event never arrives.
  const searchRelaysCast = use$(
    () =>
      subjectUser
        ? subjectUser.searchRelays$.pipe(
            timeout({
              first: SEARCH_RELAYS_LOAD_TIMEOUT_MS,
              with: () => of(null),
            }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  // Relay URLs from the cast (empty array if event found but has no relays)
  const relayList = useMemo<string[]>(
    () => searchRelaysCast?.relays ?? [],
    [searchRelaysCast],
  );

  // Pool relay instances for NIP-11 info
  const relayEntries = useMemo(
    () => relayList.map((url) => ({ url, relay: pool.relay(url) })),
    [relayList],
  );

  // Track NIP-50 check statuses per URL
  const [statuses, setStatuses] = useState<Record<string, Nip50Status>>({});

  // Track which unsupported relays the user has selected for removal
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Track publish state
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Timeout for NIP-11 checks — after 15s treat remaining "checking" as "unknown"
  const [checkTimedOut, setCheckTimedOut] = useState(false);
  const listLoaded = searchRelaysCast !== undefined;
  useEffect(() => {
    if (!listLoaded || relayList.length === 0) return;
    const timer = setTimeout(() => setCheckTimedOut(true), 15_000);
    return () => clearTimeout(timer);
  }, [listLoaded, relayList.length]);

  // Derived state
  const listNotFound = searchRelaysCast === null;

  const unsupportedUrls = useMemo(
    () => relayList.filter((url) => statuses[url] === "unsupported"),
    [relayList, statuses],
  );

  const allChecked = useMemo(
    () =>
      relayList.every(
        (url) => statuses[url] !== undefined && statuses[url] !== "checking",
      ),
    [relayList, statuses],
  );

  const allSupported = useMemo(
    () =>
      listLoaded &&
      !listNotFound &&
      relayList.length > 0 &&
      (allChecked || checkTimedOut) &&
      unsupportedUrls.length === 0,
    [
      listLoaded,
      listNotFound,
      relayList.length,
      allChecked,
      checkTimedOut,
      unsupportedUrls.length,
    ],
  );

  const canProceed = allChecked || checkTimedOut;

  // Auto-select all unsupported relays when they are discovered
  useEffect(() => {
    if (unsupportedUrls.length > 0) {
      setSelected(new Set(unsupportedUrls));
    }
  }, [unsupportedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance when all relays support NIP-50
  useEffect(() => {
    if (allSupported) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [allSupported, next]);

  // Auto-advance after successful removal
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [done, next]);

  function handleToggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }

  function handleSelectAll() {
    setSelected(new Set(unsupportedUrls));
  }

  function handleDeselectAll() {
    setSelected(new Set());
  }

  async function handleRemoveSelected() {
    if (!subjectUser || selected.size === 0) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(10007, subjectUser.pubkey);
      if (!existing)
        throw new Error("Could not find your search relay list event.");
      const tagOps = [...selected].map((url) => removeRelayTag(url));
      const draft = await factory.modify(existing, modifyPublicTags(...tagOps));
      await publishEvent(draft);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update search relay list.",
      );
    } finally {
      setPublishing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (!listLoaded) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your search relay list…
            </p>
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Not found — kind:10007 event timed out or does not exist
  // ---------------------------------------------------------------------------
  if (listNotFound) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                Search Relays
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                No search relay list found
              </h1>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
              No NIP-51 search relay list (kind:10007) could be found for this
              account. You may not have set one up yet.
            </div>
            <button className="btn btn-outline btn-sm w-full" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty list — event exists but has no relays
  // ---------------------------------------------------------------------------
  if (relayList.length === 0) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                Search Relays
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                Search relay list is empty
              </h1>
            </div>
            <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
              Your kind:10007 search relay list exists but contains no relays.
            </div>
            <button className="btn btn-outline btn-sm w-full" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // All-clear — every relay supports NIP-50 (auto-advancing)
  // ---------------------------------------------------------------------------
  if (allSupported) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <svg
                className="size-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-base-content">
                All search relays support NIP-50
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                All {relayList.length} search{" "}
                {relayList.length === 1 ? "relay supports" : "relays support"}{" "}
                search queries.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Done — removals published (auto-advancing)
  // ---------------------------------------------------------------------------
  if (done) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <svg
                className="size-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-base-content">
                Search relay list updated
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                Your updated search relay list has been published.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Search Relays
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              NIP-50 Search Support
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              Checking your NIP-51 search relay list for NIP-50 search
              capability. Relays without NIP-50 cannot fulfil search queries.
            </p>
          </div>

          {/* Relay list */}
          <div className="flex flex-col gap-3">
            {relayEntries.map(({ url, relay }) => (
              <StatusTracker
                key={url}
                relayUrl={url}
                relay={relay}
                selected={selected.has(url)}
                onToggle={handleToggle}
                onStatus={(u, s) =>
                  setStatuses((prev) =>
                    prev[u] === s ? prev : { ...prev, [u]: s },
                  )
                }
              />
            ))}
          </div>

          {/* Unsupported callout with select-all controls */}
          {unsupportedUrls.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-sm text-warning">
                {unsupportedUrls.length}{" "}
                {unsupportedUrls.length === 1 ? "relay does" : "relays do"} not
                support NIP-50 search. Select the ones you want to remove.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={handleSelectAll}
                  disabled={selected.size === unsupportedUrls.length}
                >
                  Select all
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={handleDeselectAll}
                  disabled={selected.size === 0}
                >
                  Deselect all
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {unsupportedUrls.length > 0 && (
              <button
                className="btn btn-error w-full"
                onClick={handleRemoveSelected}
                disabled={publishing || selected.size === 0}
              >
                {publishing ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : selected.size === 0 ? (
                  "No relays selected"
                ) : (
                  `Remove ${selected.size} selected ${selected.size === 1 ? "relay" : "relays"}`
                )}
              </button>
            )}
            <button
              className="btn btn-primary w-full"
              onClick={next}
              disabled={!canProceed || publishing}
            >
              {canProceed ? "Next" : "Checking…"}
            </button>
            {!canProceed && (
              <button
                className="btn btn-ghost btn-sm w-full"
                onClick={next}
                disabled={publishing}
              >
                Skip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SearchRelayNip50Report;
