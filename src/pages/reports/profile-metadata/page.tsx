import { useEffect, useState } from "react";
import { setContent } from "applesauce-core/operations";
import { use$ } from "applesauce-react/hooks";
import { timer } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { toLoaderState } from "../../../observable/operator/to-loader-state.ts";
import { useReport } from "../../../context/ReportContext.tsx";
import { eventStore } from "../../../lib/store.ts";
import { factory } from "../../../lib/factory.ts";
import {
  AUTO_ADVANCE_MS,
  EVENT_LOAD_TIMEOUT_MS,
} from "../../../lib/timeouts.ts";
import { createLoader } from "./loader.ts";

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
  function truncate(v: unknown, max = 60): string {
    const str = typeof v === "object" ? JSON.stringify(v) : String(v);
    return str.length > max ? str.slice(0, max) + "…" : str;
  }

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
  const { subject, next, publish: publishEvent } = useReport();

  // ---------------------------------------------------------------------------
  // Loader — raw Observable<ProfileMetadataState> wrapped by toLoaderState()
  // takeUntil provides the hard deadline; toLoaderState() stamps complete: true
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Page-local UI state
  // ---------------------------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-select all non-standard keys when the report first loads
  useEffect(() => {
    if (!isLoading && state?.nonStandardFields) {
      setSelected(
        new Set(state.nonStandardFields.map(([k]: [string, unknown]) => k)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Auto-advance after successful publish
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [done, next]);

  // Auto-advance if profile is clean (no non-standard fields)
  const profileClean =
    !isLoading &&
    state?.event !== null &&
    state?.nonStandardFields.length === 0;

  useEffect(() => {
    if (profileClean) {
      const timer = setTimeout(() => next(), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [profileClean, next]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

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
  // Loading state
  // ---------------------------------------------------------------------------
  if (isLoading) {
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
  // Profile not found — loader completed with event: null
  // ---------------------------------------------------------------------------
  if (state?.event === null) {
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
  // All-clear — profile has no non-standard fields (auto-advancing)
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
  // Done — fields were removed and published (auto-advancing)
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
  // Report mode — non-standard fields found
  // ---------------------------------------------------------------------------
  const nonStandardFields = state?.nonStandardFields ?? [];

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
            {nonStandardFields.map(([key, value]: [string, unknown]) => (
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
                  handlePublish(
                    new Set(
                      nonStandardFields.map(([k]: [string, unknown]) => k),
                    ),
                  )
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
