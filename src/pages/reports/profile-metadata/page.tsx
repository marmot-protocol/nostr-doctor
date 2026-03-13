import { useEffect, useState } from "react";
import { setContent } from "applesauce-core/operations";
import { eventStore } from "../../../lib/store.ts";
import { factory } from "../../../lib/factory.ts";
import type { SectionProps } from "../accordion-types.ts";
import type { ProfileMetadataState } from "./loader.ts";

// ---------------------------------------------------------------------------
// Standard fields
// ---------------------------------------------------------------------------

const STANDARD_FIELDS = new Set([
  "name",
  "about",
  "picture",
  "display_name",
  "website",
  "banner",
  "bot",
  "birthday",
  "nip05",
  "lud06",
  "lud16",
  "languages",
]);

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  display_name: "Display name",
  about: "About",
  picture: "Picture",
  banner: "Banner",
  website: "Website",
  nip05: "NIP-05",
  lud06: "LNURL",
  lud16: "Lightning address",
  bot: "Bot",
  birthday: "Birthday",
  languages: "Languages",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReadOnlyBanner() {
  return (
    <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
      You're viewing someone else's account. This fix will be queued as a draft
      — sign in as this account to publish it.
    </div>
  );
}

function QueuedBanner() {
  return (
    <div className="bg-info/10 border border-info/30 rounded-xl p-3 text-xs text-info">
      Fix queued as a draft. Sign in as this account to publish it.
    </div>
  );
}

function ProfileFieldRow({
  label,
  value,
  isNonStandard,
  willRemove,
}: {
  label: string;
  value: unknown;
  isNonStandard: boolean;
  willRemove: boolean;
}) {
  function truncate(v: unknown, max = 100): string {
    const str = typeof v === "object" ? JSON.stringify(v) : String(v);
    return str.length > max ? str.slice(0, max) + "…" : str;
  }
  return (
    <div
      className={[
        "flex gap-3 py-2 border-b border-base-200 last:border-0",
        willRemove ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="w-28 shrink-0 pt-0.5">
        <span
          className={[
            "text-xs font-medium",
            isNonStandard ? "text-error font-mono" : "text-base-content/40",
          ].join(" ")}
        >
          {label}
        </span>
        {isNonStandard && (
          <span className="block text-[10px] text-error/60 mt-0.5">
            non-standard
          </span>
        )}
      </div>
      <span
        className={[
          "text-sm break-words min-w-0 flex-1",
          willRemove
            ? "line-through text-base-content/40"
            : "text-base-content/80",
        ].join(" ")}
      >
        {truncate(value)}
      </span>
      {willRemove && (
        <span className="text-[10px] text-error shrink-0 self-start pt-0.5">
          removed
        </span>
      )}
    </div>
  );
}

function FieldSelectRow({
  fieldKey,
  value,
  checked,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  checked: boolean;
  onChange: (key: string, checked: boolean) => void;
}) {
  function truncate(v: unknown, max = 100): string {
    const str = typeof v === "object" ? JSON.stringify(v) : String(v);
    return str.length > max ? str.slice(0, max) + "…" : str;
  }
  return (
    <label className="flex items-start gap-3 rounded-xl border border-error/20 bg-error/5 p-3 cursor-pointer hover:bg-error/10 transition-colors">
      <input
        type="checkbox"
        className="checkbox checkbox-error checkbox-sm mt-0.5 shrink-0"
        checked={checked}
        onChange={(e) => onChange(fieldKey, e.target.checked)}
      />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="font-mono text-sm font-medium text-error">
          {fieldKey}
        </span>
        <span className="text-xs text-base-content/50 break-all">
          {truncate(value)}
        </span>
      </div>
    </label>
  );
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
}: SectionProps<ProfileMetadataState>) {
  const isLoading = !loaderState?.complete;
  const state = loaderState?.data;
  const isReadOnly = account === null;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishedReadOnly, setPublishedReadOnly] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!isLoading && state?.nonStandardFields) {
      setSelected(
        new Set(state.nonStandardFields.map(([k]: [string, unknown]) => k)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const profileClean =
    !isLoading &&
    state?.event !== null &&
    (state?.nonStandardFields.length ?? 0) === 0;

  useEffect(() => {
    if (profileClean && !advanced) {
      setAdvanced(true);
      onDone({ status: "clean", summary: "No non-standard fields" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileClean]);

  async function handlePublish(keysToRemove: Set<string>) {
    if (!subject) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(0, subject.pubkey);
      if (!existing) throw new Error("Could not find your profile event.");
      const currentContent = JSON.parse(existing.content) as Record<
        string,
        unknown
      >;
      const cleaned = Object.fromEntries(
        Object.entries(currentContent).filter(([k]) => !keysToRemove.has(k)),
      );
      const draft = await factory.modify(
        existing,
        setContent(JSON.stringify(cleaned)),
      );
      await publishEvent(draft);
      if (isReadOnly) {
        setPublishedReadOnly(true);
        const removed = [...keysToRemove];
        onDone({
          status: "fixed",
          summary: `${removed.length} non-standard ${removed.length === 1 ? "field" : "fields"} queued for removal`,
          detail: removed,
        });
      } else {
        setDone(true);
        const removed = [...keysToRemove];
        onDone({
          status: "fixed",
          summary: `${removed.length} non-standard ${removed.length === 1 ? "field" : "fields"} removed`,
          detail: removed,
        });
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to build profile event.",
      );
    } finally {
      setPublishing(false);
    }
  }

  function handleToggle(key: string, checked: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (checked) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-2">
        <span className="loading loading-spinner loading-sm text-primary" />
        <p className="text-sm text-base-content/60">Loading profile…</p>
      </div>
    );
  }

  if (state?.event === null) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
          No kind:0 profile event could be found. It may not exist yet, or
          relays were unreachable.
        </div>
        {!isDoneSection && (
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              onDone({ status: "notfound", summary: "Profile not found" });
              onContinue();
            }}
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  const fullContent = (() => {
    try {
      return JSON.parse(state!.event!.content) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const nonStandardFields = state?.nonStandardFields ?? [];

  // Published (signed-in)
  if (done) {
    const removedKeys = nonStandardFields.map(([k]: [string, unknown]) =>
      String(k),
    );
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
          <p className="text-sm font-medium">Profile published successfully</p>
        </div>
        {removedKeys.length > 0 && (
          <div className="rounded-xl border border-base-200 px-4 py-1">
            {Object.entries(fullContent)
              .filter(([k]) => !removedKeys.includes(k))
              .map(([key, value]) => (
                <ProfileFieldRow
                  key={key}
                  label={FIELD_LABELS[key] ?? key}
                  value={value}
                  isNonStandard={!STANDARD_FIELDS.has(key)}
                  willRemove={false}
                />
              ))}
          </div>
        )}
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

  // Read-only queued state
  if (publishedReadOnly) {
    const removedKeys = [...selected];
    return (
      <div className="flex flex-col gap-3 py-2">
        <QueuedBanner />
        <p className="text-xs text-base-content/50">
          The following fields will be removed when the draft is published:
        </p>
        <div className="rounded-xl border border-base-200 px-4 py-1">
          {removedKeys.map((key) => (
            <ProfileFieldRow
              key={key}
              label={FIELD_LABELS[key] ?? key}
              value={fullContent[key]}
              isNonStandard={true}
              willRemove={true}
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

  // All-clear
  if (profileClean) {
    const presentFields = Object.entries(fullContent).filter(
      ([, v]) => v != null && v !== "",
    );
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
            No non-standard fields — profile is clean
          </p>
        </div>
        {presentFields.length > 0 && (
          <>
            <p className="text-xs text-base-content/40">
              Here's what's in your profile event:
            </p>
            <div className="rounded-xl border border-base-200 px-4 py-1">
              {presentFields.map(([key, value]) => (
                <ProfileFieldRow
                  key={key}
                  label={FIELD_LABELS[key] ?? key}
                  value={value}
                  isNonStandard={!STANDARD_FIELDS.has(key)}
                  willRemove={false}
                />
              ))}
            </div>
          </>
        )}
        <p className="text-xs text-base-content/40">
          Non-standard fields expose client metadata and bloat the event. None
          found here.
        </p>
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

  // Report — non-standard fields found
  const allEntries = Object.entries(fullContent);
  const hasStandard = allEntries.some(([k]) => STANDARD_FIELDS.has(k));

  return (
    <div className="flex flex-col gap-5 py-2">
      <div>
        <p className="text-xs font-medium text-base-content/50 mb-2">
          Current profile fields
        </p>
        <div className="rounded-xl border border-base-200 px-4 py-1">
          {allEntries.length === 0 && (
            <p className="text-xs text-base-content/40 py-2">
              Profile content is empty.
            </p>
          )}
          {hasStandard &&
            allEntries
              .filter(([k]) => STANDARD_FIELDS.has(k))
              .map(([key, value]) => (
                <ProfileFieldRow
                  key={key}
                  label={FIELD_LABELS[key] ?? key}
                  value={value}
                  isNonStandard={false}
                  willRemove={false}
                />
              ))}
          {nonStandardFields.map(([key, value]: [string, unknown]) => (
            <ProfileFieldRow
              key={key}
              label={key}
              value={value}
              isNonStandard={true}
              willRemove={selected.has(key)}
            />
          ))}
        </div>
      </div>

      <div className="bg-error/5 border border-error/20 rounded-xl p-4 flex flex-col gap-2">
        <p className="text-sm font-medium text-base-content">
          {nonStandardFields.length} non-standard{" "}
          {nonStandardFields.length === 1 ? "field" : "fields"} found
        </p>
        <p className="text-xs text-base-content/60">
          These fields aren't part of the Nostr profile spec. They may have been
          added by older clients and can expose which apps you use. Select the
          ones to remove:
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {nonStandardFields.map(([key, value]: [string, unknown]) => (
          <FieldSelectRow
            key={key}
            fieldKey={key}
            value={value}
            checked={selected.has(key)}
            onChange={handleToggle}
          />
        ))}
      </div>

      {isReadOnly && <ReadOnlyBanner />}
      {error && (
        <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            className="btn btn-primary flex-1"
            onClick={() => handlePublish(selected)}
            disabled={publishing || selected.size === 0}
          >
            {publishing ? (
              <span className="loading loading-spinner loading-xs" />
            ) : isReadOnly ? (
              `Queue removal of ${selected.size} ${selected.size === 1 ? "field" : "fields"}`
            ) : (
              `Remove ${selected.size} selected`
            )}
          </button>
          <button
            className="btn btn-error"
            onClick={() =>
              handlePublish(
                new Set(nonStandardFields.map(([k]: [string, unknown]) => k)),
              )
            }
            disabled={publishing}
          >
            {isReadOnly ? "Queue all" : "Remove all"}
          </button>
        </div>
        <button
          className="btn btn-ghost btn-sm w-full"
          onClick={() => {
            onDone({
              status: "skipped",
              summary: `${nonStandardFields.length} non-standard ${nonStandardFields.length === 1 ? "field" : "fields"} left`,
            });
            onContinue();
          }}
          disabled={publishing}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export default ReportContent;
