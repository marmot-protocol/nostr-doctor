import { useEffect, useMemo, useState } from "react";
import type { EventTemplate } from "applesauce-core/helpers";
import { BLOSSOM_SERVER_LIST_KIND } from "applesauce-common/helpers/blossom";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { factory } from "../../../lib/factory.ts";
import { eventStore } from "../../../lib/store.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { BlossomServerStatus, BlossomServersState } from "./loader.ts";

function StatusBadge({
  status,
  isChecking,
}: {
  status: BlossomServerStatus | undefined;
  isChecking: boolean;
}) {
  if (status === "online")
    return <span className="badge badge-success badge-sm">online</span>;
  if (status === "offline")
    return <span className="badge badge-error badge-sm">offline</span>;
  if (!isChecking)
    return <span className="badge badge-ghost badge-sm">unknown</span>;
  return (
    <span className="badge badge-ghost badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

function ServerRow({
  serverUrl,
  status,
  isChecking,
}: {
  serverUrl: string;
  status: BlossomServerStatus | undefined;
  isChecking: boolean;
}) {
  const [showIcon, setShowIcon] = useState(true);
  const faviconUrl = useMemo(() => {
    try {
      return new URL("/favicon.ico", serverUrl).toString();
    } catch {
      return null;
    }
  }, [serverUrl]);

  return (
    <div
      className={[
        "flex items-center gap-2 py-2 min-w-0",
        status === "offline" ? "border-l-2 border-error pl-2 -ml-0.5" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {showIcon && faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="size-4 rounded-sm shrink-0 bg-base-200"
            onError={() => setShowIcon(false)}
          />
        ) : (
          <div className="size-4 rounded-sm shrink-0 bg-base-200" aria-hidden />
        )}
        <a
          href={serverUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-base-content/70 break-all hover:underline"
          title="Open server landing page"
        >
          {serverUrl}
        </a>
      </div>
      <StatusBadge status={status} isChecking={isChecking} />
    </div>
  );
}

export function ReportContent({
  subject,
  account,
  publish,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<BlossomServersState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const serverUrls = state?.serverUrls ?? null;
  const statusByUrl = useMemo(
    () => state?.statusByUrl ?? {},
    [state?.statusByUrl],
  );
  const urlList = useMemo(() => serverUrls ?? [], [serverUrls]);

  const offlineCount = useMemo(
    () => urlList.filter((url) => statusByUrl[url] === "offline").length,
    [urlList, statusByUrl],
  );
  const unknownCount = useMemo(
    () => urlList.filter((url) => statusByUrl[url] === null).length,
    [urlList, statusByUrl],
  );
  const allOnline = useMemo(
    () =>
      !isLoading &&
      urlList.length > 0 &&
      urlList.every((url) => statusByUrl[url] === "online"),
    [isLoading, urlList, statusByUrl],
  );

  const [reported, setReported] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
  const [removedUrls, setRemovedUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isLoading && !reported) {
      setReported(true);

      if (serverUrls === null) {
        onDone({
          status: "notfound",
          summary: "No Blossom server list found",
        });
      } else if (urlList.length === 0) {
        onDone({
          status: "notfound",
          summary: "Blossom server list is empty",
        });
      } else if (offlineCount > 0 || unknownCount > 0) {
        const parts: string[] = [];
        if (offlineCount > 0) {
          parts.push(
            `${offlineCount} offline server${offlineCount !== 1 ? "s" : ""}`,
          );
        }
        if (unknownCount > 0) {
          parts.push(
            `${unknownCount} unknown server${unknownCount !== 1 ? "s" : ""}`,
          );
        }
        onDone({
          status: "error",
          summary: parts.join(", "),
        });
      } else {
        onDone({
          status: "clean",
          summary: `${urlList.length} server${urlList.length !== 1 ? "s" : ""} online`,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            {urlList.length > 0
              ? "Checking Blossom servers with HTTP GET /…"
              : "Looking for your Blossom server list…"}
          </p>
        </div>
        {urlList.length > 0 && (
          <div className="flex flex-col gap-0 divide-y divide-base-200">
            {urlList.map((url) => (
              <ServerRow
                key={url}
                serverUrl={url}
                status={statusByUrl[url]}
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

  if (serverUrls === null) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
          No Blossom server list (kind:10063) found for this account.
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

  if (urlList.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="bg-base-200/60 rounded-xl p-4 text-sm text-base-content/60">
          Your Blossom server list (kind:10063) exists but has no servers.
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

  const isReadOnly = account === null;
  const offlineUrls = urlList
    .filter((url) => statusByUrl[url] === "offline")
    .filter((url) => !removedUrls.has(url));

  async function handleRemoveOfflineServers() {
    if (offlineUrls.length === 0) return;

    setPublishing(true);
    setPublishError(null);
    setPublishSuccess(null);

    try {
      // Read fresh from event store at publish time to avoid dropping tags
      // added after this loader run.
      const existing = eventStore.getReplaceable(
        BLOSSOM_SERVER_LIST_KIND,
        subject.pubkey,
      );
      if (!existing)
        throw new Error("Could not find Blossom server list event.");

      const tagOps = offlineUrls.map((url) => removeRelayTag(url, "server"));
      const draft: EventTemplate = await factory.modify(
        existing,
        modifyPublicTags(...tagOps),
      );
      await publish(draft);

      setPublishSuccess(
        `Queued removal of ${offlineUrls.length} offline server${offlineUrls.length !== 1 ? "s" : ""}.`,
      );
      setRemovedUrls((prev) => {
        const next = new Set(prev);
        offlineUrls.forEach((url) => next.add(url));
        return next;
      });
      onDone({
        status: "fixed",
        summary: `Queued removal of ${offlineUrls.length} offline server${offlineUrls.length !== 1 ? "s" : ""}`,
      });
    } catch (e) {
      setPublishError(
        e instanceof Error
          ? e.message
          : "Failed to update Blossom server list event.",
      );
    } finally {
      setPublishing(false);
    }
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
            All {urlList.length} Blossom server{urlList.length !== 1 ? "s" : ""}{" "}
            online
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {offlineCount > 0 && (
            <p className="text-sm text-warning">
              {offlineCount} server{offlineCount !== 1 ? "s are" : " is"}{" "}
              offline.
            </p>
          )}
          {unknownCount > 0 && (
            <p className="text-sm text-base-content/70">
              Could not confirm {unknownCount} server
              {unknownCount !== 1 ? "s" : ""}.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-0 divide-y divide-base-200">
        {urlList.map((url) => (
          <ServerRow
            key={url}
            serverUrl={url}
            status={statusByUrl[url]}
            isChecking={false}
          />
        ))}
      </div>

      {offlineUrls.length > 0 && !isDoneSection && (
        <button
          className="btn btn-error btn-sm w-full"
          onClick={handleRemoveOfflineServers}
          disabled={publishing}
        >
          {publishing ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            `Remove ${offlineUrls.length} offline server${offlineUrls.length !== 1 ? "s" : ""}`
          )}
        </button>
      )}

      {publishError && <p className="text-sm text-error">{publishError}</p>}
      {publishSuccess && (
        <p className="text-sm text-success">{publishSuccess}</p>
      )}

      {isReadOnly && (
        <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
          You're viewing someone else's account. Removals will be queued as
          drafts and can be signed at the end.
        </div>
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
