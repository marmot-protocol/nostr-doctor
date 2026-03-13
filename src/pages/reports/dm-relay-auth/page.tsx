import { useEffect, useMemo, useState } from "react";
import type { EventTemplate } from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { use$ } from "applesauce-react/hooks";
import { factory } from "../../../lib/factory.ts";
import { pool } from "../../../lib/relay.ts";
import { eventStore } from "../../../lib/store.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { DmRelayAuthState, AuthStatus } from "./loader.ts";

// ---------------------------------------------------------------------------
// AuthBadge
// ---------------------------------------------------------------------------

function AuthBadge({ status }: { status: AuthStatus | null | undefined }) {
  if (status === "protected")
    return (
      <span className="badge badge-success badge-sm whitespace-nowrap">
        Auth Required
      </span>
    );
  if (status === "unprotected")
    return (
      <span className="badge badge-error badge-sm whitespace-nowrap">
        No Auth
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
      Checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// RelayRow
// ---------------------------------------------------------------------------

function RelayRow({
  relayUrl,
  authStatus,
  selected,
  onToggle,
}: {
  relayUrl: string;
  authStatus: AuthStatus | null | undefined;
  selected: boolean;
  onToggle: (url: string) => void;
}) {
  const relay = useMemo(() => pool.relay(relayUrl), [relayUrl]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isUnprotected = authStatus === "unprotected";
  const name = info?.name ?? relayUrl;
  const description = info?.description;

  return (
    <label
      className={[
        "rounded-xl border p-4 flex items-start gap-3 transition-colors select-none",
        isUnprotected ? "cursor-pointer" : "cursor-default",
        isUnprotected
          ? selected
            ? "border-error/60 bg-error/10"
            : "border-error/30 bg-error/5"
          : "border-base-200",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isUnprotected ? (
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
      <AuthBadge status={authStatus} />
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
}: SectionProps<DmRelayAuthState>) {
  const isReadOnly = account === null;
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const relayUrls = state?.relayUrls ?? null;
  const authStatus = useMemo(
    () => state?.authStatus ?? {},
    [state?.authStatus],
  );
  const relayList = useMemo<string[]>(() => relayUrls ?? [], [relayUrls]);

  const unprotectedUrls = useMemo(
    () => relayList.filter((url) => authStatus[url] === "unprotected"),
    [relayList, authStatus],
  );

  const allProtected = useMemo(
    () =>
      !isLoading &&
      relayUrls !== null &&
      relayList.length > 0 &&
      unprotectedUrls.length === 0 &&
      relayList.every(
        (url) => authStatus[url] !== null && authStatus[url] !== undefined,
      ),
    [isLoading, relayUrls, relayList, unprotectedUrls.length, authStatus],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (unprotectedUrls.length > 0) setSelected(new Set(unprotectedUrls));
  }, [unprotectedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (allProtected && !advanced) {
      setAdvanced(true);
      onDone({
        status: "clean",
        summary: `All ${relayList.length} DM relay${relayList.length !== 1 ? "s" : ""} require auth`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProtected]);

  useEffect(() => {
    if (done) {
      onDone({
        status: "fixed",
        summary: `${selected.size} unprotected relay${selected.size !== 1 ? "s" : ""} removed`,
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
      const existing = eventStore.getReplaceable(10050, subject.pubkey);
      if (!existing)
        throw new Error(
          "Could not find your DM relay list event (kind:10050).",
        );
      const tagOps = [...selected].map((url) => removeRelayTag(url));
      const draft: EventTemplate = await factory.modify(
        existing,
        modifyPublicTags(...tagOps),
      );
      await publishEvent(draft);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update DM relay list.",
      );
    } finally {
      setPublishing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            {relayList.length > 0
              ? `Probing ${relayList.length} DM relay${relayList.length === 1 ? "" : "s"}…`
              : "Loading your DM relay list…"}
          </p>
        </div>
        {relayList.length > 0 && (
          <div className="flex flex-col gap-3">
            {relayList.map((url) => (
              <RelayRow
                key={url}
                relayUrl={url}
                authStatus={authStatus[url]}
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
          No NIP-17 DM relay list (kind:10050) found. Without one, senders won't
          know where to deliver your encrypted messages.
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({ status: "notfound", summary: "No DM relay list found" });
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
          Your kind:10050 DM relay list exists but contains no relays.
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({ status: "notfound", summary: "DM relay list empty" });
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
      <div className="flex flex-col gap-4 py-2">
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
          <p className="text-sm font-medium">DM relay list updated</p>
        </div>
        <div className="flex flex-col gap-3">
          {relayList.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              authStatus={authStatus[url]}
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

  // All protected — show all relays for review
  if (allProtected) {
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
          <p className="text-sm font-medium">All DM relays require auth</p>
        </div>
        <p className="text-xs text-base-content/40">
          Without auth enforcement, anyone can query your DM relay for encrypted
          gift wrap events.
        </p>
        <div className="flex flex-col gap-3 mt-1">
          {relayList.map((url) => (
            <RelayRow
              key={url}
              relayUrl={url}
              authStatus={authStatus[url]}
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
        Checking whether your DM relays require NIP-42 authentication to read
        gift wrap events. Relays that don't enforce auth expose your message
        metadata.
      </p>
      <div className="flex flex-col gap-3">
        {relayList.map((url) => (
          <RelayRow
            key={url}
            relayUrl={url}
            authStatus={authStatus[url]}
            selected={selected.has(url)}
            onToggle={handleToggle}
          />
        ))}
      </div>
      {unprotectedUrls.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm text-warning">
            {unprotectedUrls.length}{" "}
            {unprotectedUrls.length === 1 ? "relay does" : "relays do"} not
            require authentication.
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setSelected(new Set(unprotectedUrls))}
              disabled={selected.size === unprotectedUrls.length}
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
        {unprotectedUrls.length > 0 && (
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
            className="btn btn-ghost btn-sm w-full"
            onClick={() => {
              onDone({
                status: "skipped",
                summary: `${unprotectedUrls.length} unprotected relay${unprotectedUrls.length !== 1 ? "s" : ""} left`,
              });
              onContinue();
            }}
            disabled={publishing}
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

export default ReportContent;
