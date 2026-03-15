import { useEffect, useMemo, useState } from "react";
import type { EventTemplate } from "applesauce-core/helpers";
import {
  removeInboxRelay,
  removeOutboxRelay,
} from "applesauce-core/operations/mailboxes";
import { removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { use$ } from "applesauce-react/hooks";
import { factory } from "../../../lib/factory.ts";
import { pool } from "../../../lib/relay.ts";
import { eventStore } from "../../../lib/store.ts";
import type { SectionProps } from "../accordion-types.ts";
import type {
  AuthStatus,
  DeadRelaysState,
  Nip65RelayListState,
  RelayEntry,
  RelayListState,
  RelayMarker,
  SearchSupport,
} from "./loader.ts";
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
    return <span className="badge badge-error badge-xs">offline</span>;
  if (verdict === "online")
    return <span className="badge badge-success badge-xs">online</span>;
  if (!isChecking)
    return <span className="badge badge-ghost badge-xs">unknown</span>;
  return (
    <span className="badge badge-ghost badge-xs gap-1">
      <span className="loading loading-spinner loading-xs" />
      checking
    </span>
  );
}

// ---------------------------------------------------------------------------
// SearchBadge
// ---------------------------------------------------------------------------

function SearchBadge({ status }: { status: SearchSupport }) {
  if (status === "supported")
    return (
      <span className="badge badge-success badge-xs whitespace-nowrap">
        NIP-50 ✓
      </span>
    );
  if (status === "unsupported")
    return (
      <span className="badge badge-warning badge-xs whitespace-nowrap">
        no search
      </span>
    );
  if (status === "unknown")
    return (
      <span className="badge badge-ghost badge-xs whitespace-nowrap">
        search?
      </span>
    );
  return (
    <span className="badge badge-ghost badge-xs gap-1 whitespace-nowrap">
      <span className="loading loading-spinner loading-xs" />
      search
    </span>
  );
}

// ---------------------------------------------------------------------------
// AuthBadge
// ---------------------------------------------------------------------------

function AuthBadge({ status }: { status: AuthStatus }) {
  if (status === "protected")
    return (
      <span className="badge badge-success badge-xs whitespace-nowrap">
        auth ✓
      </span>
    );
  if (status === "unprotected")
    return (
      <span className="badge badge-error badge-xs whitespace-nowrap">
        no auth
      </span>
    );
  if (status === "unknown")
    return (
      <span className="badge badge-ghost badge-xs whitespace-nowrap">
        auth?
      </span>
    );
  return (
    <span className="badge badge-ghost badge-xs gap-1 whitespace-nowrap">
      <span className="loading loading-spinner loading-xs" />
      auth
    </span>
  );
}

// ---------------------------------------------------------------------------
// MarkerPill
// ---------------------------------------------------------------------------

function MarkerPill({ marker }: { marker: RelayMarker }) {
  const label =
    marker === "both" ? "r+w" : marker === "read" ? "read" : "write";
  return <span className="badge badge-ghost badge-xs font-mono">{label}</span>;
}

// ---------------------------------------------------------------------------
// CapabilityWarning — contextual message shown under a relay row
// ---------------------------------------------------------------------------

function CapabilityWarning({
  showSearch,
  showAuth,
  searchSupport,
  authStatus,
  verdict,
}: {
  showSearch?: boolean;
  showAuth?: boolean;
  searchSupport: SearchSupport;
  authStatus: AuthStatus;
  verdict: RelayVerdict | null;
}) {
  // Offline relay — generic message, no capability-specific advice
  if (verdict === "offline") {
    return (
      <p className="text-xs text-error/80 pl-8 pb-1">
        This relay appears to be offline. You may want to remove it so clients
        don't waste time connecting to it.
      </p>
    );
  }

  if (showSearch && searchSupport === "unsupported") {
    return (
      <p className="text-xs text-warning/80 pl-8 pb-1">
        This relay does not support NIP-50 keyword search. Nostr clients that
        use your search relay list may get no results here — consider replacing
        it with a relay that supports search.
      </p>
    );
  }

  if (showAuth && authStatus === "unprotected") {
    return (
      <p className="text-xs text-error/80 pl-8 pb-1">
        This DM relay does not require authentication before serving messages.
        Anyone can query it for your encrypted gift-wrap events (kind:1059).
        Your DM relays should enforce NIP-42 auth to protect your message
        metadata.
      </p>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// RelayRow
// ---------------------------------------------------------------------------

function RelayRow({
  entry,
  marker,
  isChecking,
  showSearch,
  showAuth,
  pendingRemove,
  removedUrls,
  onRemove,
}: {
  entry: RelayEntry;
  marker?: RelayMarker;
  isChecking: boolean;
  showSearch?: boolean;
  showAuth?: boolean;
  pendingRemove: boolean;
  removedUrls: Set<string>;
  onRemove: (url: string) => void;
}) {
  const relay = useMemo(() => pool.relay(entry.url), [entry.url]);
  const info = use$(relay.information$);
  const iconUrl = use$(relay.icon$);
  const isOffline = entry.verdict === "offline";
  const isRemoved = removedUrls.has(entry.url);
  const name = info?.name ?? entry.url;

  const searchSupport = entry.capabilities.searchSupport ?? null;
  const authStatus = entry.capabilities.authStatus ?? null;

  // Show warning when loader is done (not checking) and there's a problem
  const hasWarning =
    !isChecking &&
    !isRemoved &&
    (isOffline ||
      (showSearch && searchSupport === "unsupported") ||
      (showAuth && authStatus === "unprotected"));

  return (
    <div
      className={[
        "flex flex-col transition-opacity duration-200",
        isRemoved ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "flex items-center gap-2 py-2 min-w-0",
          isOffline && !isRemoved ? "border-l-2 border-error pl-2 -ml-0.5" : "",
          showAuth && authStatus === "unprotected" && !isRemoved
            ? "border-l-2 border-error pl-2 -ml-0.5"
            : "",
          showSearch && searchSupport === "unsupported" && !isRemoved
            ? "border-l-2 border-warning pl-2 -ml-0.5"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Icon + name */}
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
              {entry.url}
            </span>
          </div>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {marker && <MarkerPill marker={marker} />}
          {showSearch && <SearchBadge status={searchSupport} />}
          {showAuth && <AuthBadge status={authStatus} />}
          <VerdictBadge verdict={entry.verdict} isChecking={isChecking} />
        </div>

        {/* Remove / trash button */}
        {isRemoved ? (
          <span className="badge badge-warning badge-xs shrink-0">queued</span>
        ) : (
          <button
            className="btn btn-ghost btn-xs text-base-content/30 hover:text-error hover:bg-error/10 shrink-0"
            onClick={() => onRemove(entry.url)}
            disabled={pendingRemove}
            aria-label={`Queue removal of ${entry.url}`}
            title="Remove from list"
          >
            <svg
              className="size-3.5"
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
          </button>
        )}
      </div>

      {/* Contextual warning message */}
      {hasWarning && (
        <CapabilityWarning
          showSearch={showSearch}
          showAuth={showAuth}
          searchSupport={searchSupport}
          authStatus={authStatus}
          verdict={entry.verdict}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListSection — generic renderer for any relay list
// ---------------------------------------------------------------------------

type ListSectionConfig = {
  label: string;
  eventKind: number;
  state: RelayListState | null | undefined;
  markers?: Record<string, RelayMarker>;
  showSearch?: boolean;
  showAuth?: boolean;
  isChecking: boolean;
  subjectPubkey: string;
  publish: (template: EventTemplate) => Promise<void>;
};

function ListSection({
  label,
  eventKind,
  state,
  markers,
  showSearch,
  showAuth,
  isChecking,
  subjectPubkey,
  publish,
}: ListSectionConfig) {
  const urls = state?.urls ?? null;
  const entries = state?.entries ?? {};

  // Track which URLs are queued for removal (local UI state)
  const [removedUrls, setRemovedUrls] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const urlList = useMemo(() => urls ?? [], [urls]);
  const pendingRemovals = useMemo(
    () => urlList.filter((url) => removedUrls.has(url)),
    [urlList, removedUrls],
  );

  function handleToggleRemove(url: string) {
    setRemovedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handlePublishRemovals() {
    // Safety: only remove URLs that are actually in the current list
    const safeRemovals = pendingRemovals.filter((url) => urlList.includes(url));
    if (safeRemovals.length === 0) return;

    setPublishing(true);
    setError(null);
    try {
      // Read the event fresh from the store at publish time — never from
      // stale loader state — so we never accidentally wipe relay tags that
      // were added after the loader ran.
      const existing = eventStore.getReplaceable(eventKind, subjectPubkey);
      if (!existing) throw new Error(`Could not find kind:${eventKind} event.`);

      let draft: EventTemplate;

      if (eventKind === 10002) {
        // NIP-65: for each queued URL, only remove the specific side(s)
        // indicated by its marker. Unrelated relay tags are untouched.
        let current: EventTemplate = existing;
        for (const url of safeRemovals) {
          const marker = markers?.[url];
          if (!marker || marker === "both" || marker === "write") {
            current = await factory.modify(current, removeOutboxRelay(url));
          }
          if (!marker || marker === "both" || marker === "read") {
            current = await factory.modify(current, removeInboxRelay(url));
          }
        }
        draft = current;
      } else {
        // All other list kinds: apply one removeRelayTag per queued URL in a
        // single modify call — the rest of the list is preserved untouched.
        const tagOps = safeRemovals.map((url) => removeRelayTag(url));
        draft = await factory.modify(existing, modifyPublicTags(...tagOps));
      }

      await publish(draft);
      setPublished(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update relay list.");
    } finally {
      setPublishing(false);
    }
  }

  // Don't render if list event not found
  if (urls === null || urlList.length === 0) return null;

  const removedCount = pendingRemovals.length;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
          {label}
        </span>
        {removedCount > 0 && !published && (
          <button
            className="btn btn-error btn-xs"
            onClick={handlePublishRemovals}
            disabled={publishing}
          >
            {publishing ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              `Remove ${removedCount}`
            )}
          </button>
        )}
        {published && (
          <span className="badge badge-success badge-xs">updated</span>
        )}
      </div>

      {/* Relay rows */}
      <div className="flex flex-col divide-y divide-base-200">
        {urlList.map((url) => (
          <RelayRow
            key={url}
            entry={entries[url] ?? { url, verdict: null, capabilities: {} }}
            marker={markers?.[url]}
            isChecking={isChecking}
            showSearch={showSearch}
            showAuth={showAuth}
            pendingRemove={publishing}
            removedUrls={published ? new Set() : removedUrls}
            onRemove={handleToggleRemove}
          />
        ))}
      </div>

      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOffline(
  state: RelayListState | Nip65RelayListState | null | undefined,
): number {
  if (!state?.urls) return 0;
  return state.urls.filter((url) => state.entries[url]?.verdict === "offline")
    .length;
}

// ---------------------------------------------------------------------------
// ReportContent
// ---------------------------------------------------------------------------

export function ReportContent({
  subject,
  account,
  publish: publishEvent,
  loaderState,
  onDone,
  onContinue,
  isDoneSection,
}: SectionProps<DeadRelaysState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;

  const hasAnyRelays = useMemo(() => {
    if (!state) return false;
    return (
      (state.nip65.urls?.length ?? 0) > 0 ||
      (state.favoriteRelays.urls?.length ?? 0) > 0 ||
      (state.searchRelays.urls?.length ?? 0) > 0 ||
      (state.dmRelays.urls?.length ?? 0) > 0 ||
      (state.blockedRelays.urls?.length ?? 0) > 0
    );
  }, [state]);

  const totalOffline = useMemo(() => {
    if (!state) return 0;
    return (
      countOffline(state.nip65) +
      countOffline(state.favoriteRelays) +
      countOffline(state.searchRelays) +
      countOffline(state.dmRelays) +
      countOffline(state.blockedRelays)
    );
  }, [state]);

  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (!isLoading && hasAnyRelays && !reported) {
      setReported(true);
      const total =
        (state?.nip65.urls?.length ?? 0) +
        (state?.favoriteRelays.urls?.length ?? 0) +
        (state?.searchRelays.urls?.length ?? 0) +
        (state?.dmRelays.urls?.length ?? 0) +
        (state?.blockedRelays.urls?.length ?? 0);
      onDone({
        status: totalOffline > 0 ? "error" : "clean",
        summary:
          totalOffline > 0
            ? `${totalOffline} offline relay${totalOffline !== 1 ? "s" : ""} found`
            : `All ${total} relay${total !== 1 ? "s" : ""} online`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasAnyRelays]);

  const isReadOnly = account === null;

  const commonProps = {
    isChecking: isLoading,
    subjectPubkey: subject.pubkey,
    publish: publishEvent,
  };

  const content = (
    <div className="flex flex-col gap-5">
      <ListSection
        label="Relay List (NIP-65)"
        eventKind={10002}
        state={state?.nip65}
        markers={state?.nip65.markers}
        {...commonProps}
      />
      <ListSection
        label="Favorite Relays"
        eventKind={10012}
        state={state?.favoriteRelays}
        {...commonProps}
      />
      <ListSection
        label="Search Relays"
        eventKind={10007}
        state={state?.searchRelays}
        showSearch
        {...commonProps}
      />
      <ListSection
        label="DM Relays"
        eventKind={10050}
        state={state?.dmRelays}
        showAuth
        {...commonProps}
      />
      <ListSection
        label="Blocked Relays"
        eventKind={10006}
        state={state?.blockedRelays}
        {...commonProps}
      />
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-sm text-primary" />
          <p className="text-sm text-base-content/60">
            {hasAnyRelays
              ? "Checking relay connectivity…"
              : "Loading relay lists…"}
          </p>
        </div>
        {hasAnyRelays && content}
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

  if (!hasAnyRelays) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <p className="text-sm text-warning">
          No relay lists could be found for this account.
        </p>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({ status: "notfound", summary: "No relay lists found" });
              onContinue();
            }}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {/* Summary */}
      {totalOffline === 0 ? (
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
          <p className="text-sm font-medium">All relays online</p>
        </div>
      ) : (
        <p className="text-sm text-warning">
          {totalOffline} offline relay{totalOffline !== 1 ? "s" : ""} found —
          click the trash icon to queue removal.
        </p>
      )}

      {content}

      {isReadOnly && (
        <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
          You're viewing someone else's account. Removals will be queued as
          drafts and need signing at the end.
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
