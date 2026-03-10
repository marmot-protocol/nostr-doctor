import { useEffect, useMemo, useState } from "react";
import { of, timeout } from "rxjs";
import { setContent } from "applesauce-core/operations";
import { use$ } from "applesauce-react/hooks";
import { useApp } from "../../context/AppContext.tsx";
import { eventStore } from "../../lib/store.ts";
import { factory } from "../../lib/factory.ts";

/** ms to wait for kind:0 before treating the profile as not found */
const PROFILE_LOAD_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Standard kind 0 fields per NIP-01, NIP-24, NIP-05, NIP-57
// displayName and username are deprecated per NIP-24 — treated as non-standard
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
]);

function truncate(value: unknown, max = 60): string {
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ---------------------------------------------------------------------------
// FieldRow — a single selectable non-standard field
// ---------------------------------------------------------------------------

function FieldRow({
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
  return (
    <label className="flex items-start gap-3 rounded-xl border border-base-200 p-3 cursor-pointer hover:bg-base-200/40 transition-colors">
      <input
        type="checkbox"
        className="checkbox checkbox-sm mt-0.5 shrink-0"
        checked={checked}
        onChange={(e) => onChange(fieldKey, e.target.checked)}
      />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="font-mono text-sm font-medium text-base-content">
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
// Main page
// ---------------------------------------------------------------------------

function ProfileMetadataReport() {
  const { subject: subjectUser, next, publish: publishEvent } = useApp();

  // Subscribe to the user's kind 0 profile (triggers auto-load via eventLoader).
  // Pipes a timeout so the stream resolves to null (not found) rather than
  // staying undefined (loading) forever if kind:0 never arrives from relays.
  const profile = use$(
    () =>
      subjectUser
        ? subjectUser.profile$.pipe(
            timeout({ first: PROFILE_LOAD_TIMEOUT_MS, with: () => of(null) }),
          )
        : undefined,
    [subjectUser?.pubkey],
  );

  // Get the raw event from the store for JSON parsing
  const rawEvent = subjectUser?.pubkey
    ? eventStore.getReplaceable(0, subjectUser.pubkey)
    : null;

  // Derive non-standard fields from raw event content
  const nonStandardFields = useMemo<[string, unknown][]>(() => {
    if (!rawEvent) return [];
    try {
      const content = JSON.parse(rawEvent.content) as Record<string, unknown>;
      return Object.entries(content).filter(([k]) => !STANDARD_FIELDS.has(k));
    } catch {
      return [];
    }
  }, [rawEvent]);

  // Selection state — pre-select all non-standard keys when they first appear
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(nonStandardFields.map(([k]) => k)));
  }, [rawEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-advance after successful publish
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [done, next]);

  // profile is undefined while loading, null if timed-out/not-found, value when loaded
  const profileLoaded = profile !== undefined;
  const profileNotFound = profile === null;
  const profileClean =
    profileLoaded && !profileNotFound && nonStandardFields.length === 0;

  // Auto-advance if profile is clean (no non-standard fields)
  useEffect(() => {
    if (profileClean) {
      const timer = setTimeout(() => next(), 1500);
      return () => clearTimeout(timer);
    }
  }, [profileClean, next]);

  async function handlePublish(keysToRemove: Set<string>) {
    if (!subjectUser) return;
    setPublishing(true);
    setError(null);
    try {
      const existing = eventStore.getReplaceable(0, subjectUser.pubkey);
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
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish profile.");
    } finally {
      setPublishing(false);
    }
  }

  function handleToggle(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Loading state — profile stream has not yet emitted
  // (resolves to null after PROFILE_LOAD_TIMEOUT_MS if kind:0 never arrives)
  // ---------------------------------------------------------------------------
  if (!profileLoaded) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6 items-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm text-base-content/60">
              Loading your profile…
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
  // Profile not found — stream timed out, no kind:0 event on relays
  // ---------------------------------------------------------------------------
  if (profileNotFound) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                Profile Metadata
              </p>
              <h1 className="text-2xl font-semibold text-base-content">
                Profile not found
              </h1>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
              No kind:0 profile event could be found for this account. It may
              not exist yet, or relays were unreachable.
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
  // All-clear state — profile has no non-standard fields
  // ---------------------------------------------------------------------------
  if (profileClean) {
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
                Profile looks clean
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                No non-standard fields found in your profile metadata.
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
  // Done state — fields were removed and published
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
                Profile cleaned
              </h2>
              <p className="text-sm text-base-content/60 mt-1">
                Your updated profile has been published.
              </p>
            </div>
            <span className="loading loading-dots loading-sm text-base-content/40" />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main view — non-standard fields found
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {/* Header */}
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Profile Metadata
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              Non-standard fields
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              {nonStandardFields.length} non-standard{" "}
              {nonStandardFields.length === 1 ? "field" : "fields"} found in
              your profile. Select the ones you want to remove.
            </p>
          </div>

          {/* Field list */}
          <div className="flex flex-col gap-2">
            {nonStandardFields.map(([key, value]) => (
              <FieldRow
                key={key}
                fieldKey={key}
                value={value}
                checked={selected.has(key)}
                onChange={handleToggle}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-xs text-error">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                className="btn btn-primary flex-1"
                onClick={() => handlePublish(selected)}
                disabled={publishing || selected.size === 0}
              >
                {publishing ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  `Remove Selected (${selected.size})`
                )}
              </button>
              <button
                className="btn btn-error"
                onClick={() =>
                  handlePublish(new Set(nonStandardFields.map(([k]) => k)))
                }
                disabled={publishing}
              >
                {publishing ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Remove All"
                )}
              </button>
            </div>
            <button
              className="btn btn-ghost w-full"
              onClick={next}
              disabled={publishing}
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfileMetadataReport;
