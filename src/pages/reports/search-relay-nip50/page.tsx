import { useEffect, useMemo, useState } from "react";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { use$ } from "applesauce-react/hooks";
import { timer } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { toLoaderState } from "../../../observable/operator/to-loader-state.ts";
import { useReport } from "../../../context/ReportContext.tsx";
import { eventStore } from "../../../lib/store.ts";
import { factory } from "../../../lib/factory.ts";
import { pool } from "../../../lib/relay.ts";
import {
  AUTO_ADVANCE_MS,
  EVENT_LOAD_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";
import { createLoader } from "./loader.ts";

// ---------------------------------------------------------------------------
// Nip50Badge — derives status directly from the NIP-11 supported array
// ---------------------------------------------------------------------------

type Nip50Status = "checking" | "supported" | "unsupported" | "unknown";

function nip50StatusFrom(supported: number[] | null | undefined): Nip50Status {
  if (supported === undefined) return "checking"; // loader still in progress
  if (supported === null) return "unknown"; // fetch failed
  if (supported.includes(50)) return "supported";
  return "unsupported";
}

function Nip50Badge({ status }: { status: Nip50Status }) {
  if (status === "supported")
    return <span className="badge badge-success badge-sm">NIP-50</span>;
  if (status === "unsupported")
    return <span className="badge badge-error badge-sm">No NIP-50</span>;
  if (status === "unknown")
    return <span className="badge badge-ghost badge-sm">Unknown</span>;
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — reads NIP-11 status from loader state, not from a hook
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  supported,
  selected,
  onToggle,
}: {
  relayUrl: string;
  supported: number[] | null | undefined;
  selected: boolean;
  onToggle: (url: string) => void;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const status = nip50StatusFrom(supported);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isUnsupported = status === "unsupported";
  const name = info?.name ?? relayUrl;
  const description = info?.description;

  return (
    <label
      className={[
        "rounded-xl border p-4 flex items-start gap-3 transition-colors select-none",
        isUnsupported
          ? selected
            ? "border-error/60 bg-error/10 cursor-pointer"
            : "border-error/30 bg-error/5 cursor-pointer"
          : "border-base-200 cursor-default",
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
      <Nip50Badge status={status} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function SearchRelayNip50Report() {
  const { subject, next, publish: publishEvent } = useReport();

  // -------------------------------------------------------------------------
  // Loader — streams SearchRelayNip50State including per-relay NIP-11 data
  // -------------------------------------------------------------------------
  const loaderState = use$(
    () =>
      subject
        ? createLoader(subject).pipe(
            takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)),
            toLoaderState(),
          )
        : undefined,
    [subject?.pubkey],
  );

  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const relayUrls = state?.relayUrls ?? null;
  const nip11 = useMemo(() => state?.nip11 ?? {}, [state?.nip11]);
  const relayList = useMemo<string[]>(() => relayUrls ?? [], [relayUrls]);

  // -------------------------------------------------------------------------
  // Derive verdicts from loader state (no React hooks needed)
  // -------------------------------------------------------------------------
  const unsupportedUrls = useMemo(
    () =>
      relayList.filter((url) => nip50StatusFrom(nip11[url]) === "unsupported"),
    [relayList, nip11],
  );

  const allSupported = useMemo(
    () =>
      !isLoading &&
      relayUrls !== null &&
      relayList.length > 0 &&
      unsupportedUrls.length === 0 &&
      relayList.every((url) => nip50StatusFrom(nip11[url]) !== "checking"),
    [isLoading, relayUrls, relayList, unsupportedUrls.length, nip11],
  );

  // -------------------------------------------------------------------------
  // Page-local UI state — selection, publish
  // -------------------------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select unsupported relays when first discovered
  useEffect(() => {
    if (unsupportedUrls.length > 0) setSelected(new Set(unsupportedUrls));
  }, [unsupportedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance when all relays support NIP-50
  useEffect(() => {
    if (allSupported) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [allSupported, next]);

  // Auto-advance after successful removal
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(t);
    }
  }, [done, next]);

  function handleToggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleRemoveSelected() {
    if (!subject || selected.size === 0) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(10007, subject.pubkey);
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

  // -------------------------------------------------------------------------
  // Loading — show partial relay rows with "checking" badges as they stream in
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <span className="loading loading-spinner loading-lg text-primary shrink-0" />
              <p className="text-sm text-base-content/60">
                {relayList.length > 0
                  ? `Checking ${relayList.length} relay${relayList.length === 1 ? "" : "s"}…`
                  : "Loading your search relay list…"}
              </p>
            </div>
            {relayList.length > 0 && (
              <div className="flex flex-col gap-3">
                {relayList.map((url) => (
                  <RelayRow
                    key={url}
                    relayUrl={url}
                    supported={nip11[url]}
                    selected={selected.has(url)}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={next}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not found
  if (relayUrls === null) {
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
              account.
            </div>
            <button className="btn btn-outline btn-sm w-full" onClick={next}>
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty list
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

  // All-clear (auto-advancing)
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

  // Done (auto-advancing)
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

  // Main report view
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
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

          <div className="flex flex-col gap-3">
            {relayList.map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                supported={nip11[url]}
                selected={selected.has(url)}
                onToggle={handleToggle}
              />
            ))}
          </div>

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
                  onClick={() => setSelected(new Set(unsupportedUrls))}
                  disabled={selected.size === unsupportedUrls.length}
                >
                  Select all
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                >
                  Deselect all
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

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
              disabled={publishing}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SearchRelayNip50Report;
