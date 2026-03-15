import { useEffect, useMemo, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { pool } from "../../../lib/relay.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { KeyPackageRelayListState } from "./loader.ts";
import type { RelayVerdict } from "../../../lib/relay-monitors.ts";

// ---------------------------------------------------------------------------
// VerdictBadge
// ---------------------------------------------------------------------------

function VerdictBadge({
  verdict,
  isChecking,
}: {
  verdict: RelayVerdict | null | undefined;
  isChecking: boolean;
}) {
  if (verdict === "offline")
    return <span className="badge badge-error badge-sm">offline</span>;
  if (verdict === "online")
    return <span className="badge badge-success badge-sm">online</span>;
  if (!isChecking)
    return <span className="badge badge-ghost badge-sm">unknown</span>;
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  verdict,
  isChecking,
}: {
  relayUrl: string;
  verdict: RelayVerdict | null | undefined;
  isChecking: boolean;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isOffline = verdict === "offline";
  const name = info?.name ?? relayUrl;

  return (
    <div
      className={[
        "flex items-center gap-2 py-2 min-w-0",
        isOffline ? "border-l-2 border-error pl-2 -ml-0.5" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="size-6 rounded shrink-0 object-cover bg-base-200"
          />
        ) : (
          <div
            className="size-6 rounded shrink-0 bg-base-200 flex items-center justify-center text-base-content/40 text-[10px] font-mono"
            aria-hidden
          >
            …
          </div>
        )}
        <div className="min-w-0 flex flex-col gap-0">
          <span className="font-medium text-sm text-base-content truncate leading-tight">
            {name}
          </span>
          <span className="font-mono text-[11px] text-base-content/50 truncate">
            {relayUrl}
          </span>
        </div>
      </div>
      <VerdictBadge verdict={verdict} isChecking={isChecking} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportContent
// ---------------------------------------------------------------------------

export function ReportContent({
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<KeyPackageRelayListState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const relayUrls = state?.relayUrls ?? null;
  const verdicts = useMemo(() => state?.verdicts ?? {}, [state?.verdicts]);
  const urlList = useMemo(() => relayUrls ?? [], [relayUrls]);

  const offlineCount = useMemo(
    () => urlList.filter((url) => verdicts[url] === "offline").length,
    [urlList, verdicts],
  );

  const allOnline = useMemo(
    () =>
      !isLoading &&
      urlList.length > 0 &&
      urlList.every((url) => verdicts[url] === "online"),
    [isLoading, urlList, verdicts],
  );

  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (!isLoading && !reported) {
      setReported(true);
      if (relayUrls === null) {
        onDone({
          status: "notfound",
          summary: "No key package relay list found",
        });
      } else if (urlList.length === 0) {
        onDone({
          status: "notfound",
          summary: "Key package relay list is empty",
        });
      } else if (offlineCount > 0) {
        onDone({
          status: "error",
          summary: `${offlineCount} offline relay${offlineCount !== 1 ? "s" : ""}`,
        });
      } else {
        onDone({
          status: "clean",
          summary: `${urlList.length} relay${urlList.length !== 1 ? "s" : ""} online`,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            {urlList.length > 0
              ? "Checking key package relay connectivity…"
              : "Looking for your key package relay list…"}
          </p>
        </div>
        {urlList.length > 0 && (
          <div className="flex flex-col gap-0 divide-y divide-base-200">
            {urlList.map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                verdict={verdicts[url]}
                isChecking={true}
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

  // Not found
  if (relayUrls === null) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
          No key package relay list (kind:10051) found. This list tells others
          where to deliver MLS key packages for you.
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

  // Empty list
  if (urlList.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
          Your key package relay list (kind:10051) exists but contains no
          relays.
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
      {allOnline ? (
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
            All {urlList.length} key package relay
            {urlList.length !== 1 ? "s" : ""} online
          </p>
        </div>
      ) : offlineCount > 0 ? (
        <p className="text-sm text-warning">
          {offlineCount} relay{offlineCount !== 1 ? "s are" : " is"} offline.
          Others may not be able to deliver key packages to you.
        </p>
      ) : null}

      <div className="flex flex-col gap-0 divide-y divide-base-200">
        {urlList.map((url) => (
          <RelayRow
            key={url}
            relayUrl={url}
            verdict={verdicts[url]}
            isChecking={false}
          />
        ))}
      </div>

      {!isDoneSection && (
        <button className="btn btn-primary btn-sm w-full" onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  );
}

export default ReportContent;
