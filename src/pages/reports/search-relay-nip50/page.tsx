import { useEffect, useMemo, useState } from "react";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { use$ } from "applesauce-react/hooks";
import { factory } from "../../../lib/factory.ts";
import { pool } from "../../../lib/relay.ts";
import { eventStore } from "../../../lib/store.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { SearchProbeStatus, SearchRelayNip50State } from "./loader.ts";

// ---------------------------------------------------------------------------
// Derived status helpers
// ---------------------------------------------------------------------------

type Nip11Status = "checking" | "declared" | "not-declared" | "unknown";

function nip11StatusFrom(supported: number[] | null | undefined): Nip11Status {
  if (supported === undefined) return "checking";
  if (supported === null) return "unknown";
  if (supported.includes(50)) return "declared";
  return "not-declared";
}

/**
 * Combined verdict: a relay is "unsupported" only when BOTH checks definitively
 * say it doesn't support NIP-50. If either check confirms support, it's ok.
 * If checks are still running, it's "checking". If both are inconclusive, "unknown".
 */
type RelayVerdict =
  | "checking" // at least one check still in progress
  | "supported" // at least one check confirmed support
  | "unsupported" // both checks completed and both say no support
  | "unknown"; // both completed but inconclusive (no CLOSED, no supported_nips)

function relayVerdict(
  nip11: number[] | null | undefined,
  probe: SearchProbeStatus,
): RelayVerdict {
  const nip11Status = nip11StatusFrom(nip11);
  const probeKnown = probe !== null;
  const nip11Known = nip11Status !== "checking";

  if (!probeKnown || !nip11Known) return "checking";

  // Either check confirming support → verdict is supported
  if (nip11Status === "declared" || probe === "supported") return "supported";
  // Both explicitly negative
  if (nip11Status === "not-declared" && probe === "unsupported")
    return "unsupported";
  // Mixed inconclusive (unknown probe + no declaration, etc.)
  return "unknown";
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function Nip11Badge({ status }: { status: Nip11Status }) {
  if (status === "declared")
    return (
      <span className="badge badge-success badge-sm whitespace-nowrap">
        NIP-50 declared
      </span>
    );
  if (status === "not-declared")
    return (
      <span className="badge badge-warning badge-sm whitespace-nowrap">
        Not declared
      </span>
    );
  if (status === "unknown")
    return (
      <span className="badge badge-ghost badge-sm whitespace-nowrap">
        No NIP-11
      </span>
    );
  return (
    <span className="badge badge-ghost badge-sm gap-1 whitespace-nowrap">
      <span className="loading loading-spinner loading-xs" />
      NIP-11
    </span>
  );
}

function ProbeBadge({ status }: { status: SearchProbeStatus }) {
  if (status === "supported")
    return (
      <span className="badge badge-success badge-sm whitespace-nowrap">
        Search works
      </span>
    );
  if (status === "unsupported")
    return (
      <span className="badge badge-error badge-sm whitespace-nowrap">
        No search
      </span>
    );
  if (status === "unknown")
    return (
      <span className="badge badge-ghost badge-sm whitespace-nowrap">
        Unknown
      </span>
    );
  return (
    <span className="badge badge-ghost badge-sm gap-1 whitespace-nowrap">
      <span className="loading loading-spinner loading-xs" />
      probing
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow — matches dm-relay-auth card layout
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  nip11Supported,
  searchProbe,
  selected,
  onToggle,
}: {
  relayUrl: string;
  nip11Supported: number[] | null | undefined;
  searchProbe: SearchProbeStatus;
  selected: boolean;
  onToggle: (url: string) => void;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const verdict = relayVerdict(nip11Supported, searchProbe);
  const isUnsupported = verdict === "unsupported";
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
      {/* Two badges: NIP-11 declaration + live probe result */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Nip11Badge status={nip11StatusFrom(nip11Supported)} />
        <ProbeBadge status={searchProbe} />
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// ReportContent
// ---------------------------------------------------------------------------

function ReadOnlyBanner() {
  return (
    <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
      You're viewing someone else's account. Removals will be queued as drafts
      and need signing at the end.
    </div>
  );
}

export function ReportContent({
  subject,
  account,
  publish: publishEvent,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<SearchRelayNip50State>) {
  const isReadOnly = account === null;
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const relayUrls = state?.relayUrls ?? null;
  const nip11 = useMemo(() => state?.nip11 ?? {}, [state?.nip11]);
  const searchProbe = useMemo(
    () => state?.searchProbe ?? {},
    [state?.searchProbe],
  );
  const relayList = useMemo<string[]>(() => relayUrls ?? [], [relayUrls]);

  // A relay is "unsupported" when the combined verdict says so
  const unsupportedUrls = useMemo(
    () =>
      relayList.filter(
        (url) => relayVerdict(nip11[url], searchProbe[url]) === "unsupported",
      ),
    [relayList, nip11, searchProbe],
  );

  // All checks complete and no relay is unsupported
  const allSupported = useMemo(
    () =>
      !isLoading &&
      relayUrls !== null &&
      relayList.length > 0 &&
      unsupportedUrls.length === 0 &&
      relayList.every(
        (url) => relayVerdict(nip11[url], searchProbe[url]) !== "checking",
      ),
    [
      isLoading,
      relayUrls,
      relayList,
      unsupportedUrls.length,
      nip11,
      searchProbe,
    ],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (unsupportedUrls.length > 0) setSelected(new Set(unsupportedUrls));
  }, [unsupportedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (allSupported && !advanced) {
      setAdvanced(true);
      onDone({
        status: "clean",
        summary: `All ${relayList.length} relay${relayList.length !== 1 ? "s" : ""} support NIP-50`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSupported]);

  useEffect(() => {
    if (done) {
      onDone({
        status: "fixed",
        summary: `${selected.size} relay${selected.size !== 1 ? "s" : ""} without NIP-50 removed`,
        detail: [...selected],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  function handleToggle(url: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
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

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-4">
          <span className="loading loading-spinner loading-sm text-primary shrink-0" />
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
                nip11Supported={nip11[url]}
                searchProbe={searchProbe[url] ?? null}
                selected={selected.has(url)}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
        {!isDoneSection && (
          <button
            className="btn btn-ghost btn-sm"
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

  if (relayUrls === null) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
          No NIP-51 search relay list (kind:10007) could be found.
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({
                status: "notfound",
                summary: "No search relay list found",
              });
              onContinue();
            }}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  if (relayList.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
          Your kind:10007 search relay list exists but contains no relays.
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({
                status: "notfound",
                summary: "Search relay list empty",
              });
              onContinue();
            }}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-2 text-success">
          <svg
            className="size-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-sm font-medium">Search relay list updated</p>
        </div>
        <div className="flex flex-col gap-3">
          {relayList
            .filter((u) => !selected.has(u))
            .map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                nip11Supported={nip11[url]}
                searchProbe={searchProbe[url] ?? null}
                selected={false}
                onToggle={() => {}}
              />
            ))}
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={onContinue}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  // All-clear — show all relays for review
  if (allSupported) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-2 text-success">
          <svg
            className="size-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-sm font-medium">
            All search relays support NIP-50
          </p>
        </div>
        <p className="text-xs text-base-content/40">
          Checked via NIP-11 declaration and live search query.
        </p>
        <div className="flex flex-col gap-3 mt-1">
          {relayList.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              nip11Supported={nip11[url]}
              searchProbe={searchProbe[url] ?? null}
              selected={false}
              onToggle={() => {}}
            />
          ))}
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={onContinue}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-sm text-base-content/70">
        Checking your search relay list for NIP-50 support — via NIP-11 relay
        info and a live search query. Relays without NIP-50 cannot fulfil search
        queries.
      </p>
      <div className="flex flex-col gap-3">
        {relayList.map((url) => (
          <RelayRow
            key={url}
            relayUrl={url}
            nip11Supported={nip11[url]}
            searchProbe={searchProbe[url] ?? null}
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
            support NIP-50.
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
      {isReadOnly && <ReadOnlyBanner />}
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
            ) : isReadOnly ? (
              `Queue removal of ${selected.size} selected ${selected.size === 1 ? "relay" : "relays"}`
            ) : (
              `Remove ${selected.size} selected ${selected.size === 1 ? "relay" : "relays"}`
            )}
          </button>
        )}
        {!isDoneSection && (
          <button
            className="btn btn-primary w-full"
            onClick={() => {
              if (unsupportedUrls.length > 0) {
                onDone({
                  status: "skipped",
                  summary: `${unsupportedUrls.length} relay${unsupportedUrls.length !== 1 ? "s" : ""} without NIP-50 left`,
                });
              } else {
                onDone({ status: "clean", summary: "All relays checked" });
              }
              onContinue();
            }}
            disabled={publishing}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

export default ReportContent;
