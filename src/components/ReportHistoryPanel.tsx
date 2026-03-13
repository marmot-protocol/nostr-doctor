import { useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { useLocation } from "react-router";
import { completedSteps$ } from "../lib/completedSteps.ts";
import type { StepOutcome, StepStatus } from "../lib/completedSteps.ts";
import { pagePath } from "../lib/routing.ts";
import REPORTS from "../pages/reports.tsx";
import type { PageDefinition } from "../context/ReportContext.tsx";

// ---------------------------------------------------------------------------
// Human-readable labels for each report step
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<string, string> = {
  "profile-metadata": "Profile Metadata",
  "dead-relays": "Dead Relays",
  "dm-relay-auth": "DM Relay Auth",
  "follow-list-relays": "Follow List Relays",
  "metadata-broadcast": "Metadata Broadcast",
  "search-relay-nip50": "Search Relays",
};

// ---------------------------------------------------------------------------
// Status icon helpers
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
}: {
  status: StepStatus | "current" | "pending";
}) {
  if (status === "current") {
    return (
      <span className="size-5 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
        <span className="size-2 rounded-full bg-primary" />
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="size-5 rounded-full border-2 border-base-300 shrink-0" />
    );
  }
  if (status === "clean") {
    return (
      <span className="size-5 rounded-full bg-success/20 flex items-center justify-center shrink-0">
        <svg
          className="size-3 text-success"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </span>
    );
  }
  if (status === "fixed") {
    return (
      <span className="size-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
        <svg
          className="size-3 text-primary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="size-5 rounded-full bg-base-200 flex items-center justify-center shrink-0">
        <svg
          className="size-3 text-base-content/40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="size-5 rounded-full bg-error/20 flex items-center justify-center shrink-0">
        <svg
          className="size-3 text-error"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </span>
    );
  }
  // notfound
  return (
    <span className="size-5 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
      <svg
        className="size-3 text-warning"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={3}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v4m0 4h.01"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// StepRow — a single step in the history panel
// ---------------------------------------------------------------------------

function StepRow({
  page,
  outcome,
  isCurrent,
  stepNumber,
}: {
  page: PageDefinition;
  outcome: StepOutcome | undefined;
  isCurrent: boolean;
  stepNumber: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = STEP_LABELS[page.name] ?? page.name;

  const iconStatus = isCurrent
    ? "current"
    : outcome
      ? outcome.status
      : "pending";

  const hasDetail = outcome && outcome.detail && outcome.detail.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <button
        className={[
          "flex items-center gap-3 w-full text-left rounded-lg px-2 py-1.5 transition-colors",
          isCurrent ? "bg-base-200/80" : "hover:bg-base-200/40",
          !outcome && !isCurrent ? "opacity-50" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined}
      >
        <StatusIcon status={iconStatus} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] text-base-content/40 font-mono tabular-nums shrink-0">
              {stepNumber}
            </span>
            <span
              className={[
                "text-sm font-medium truncate",
                isCurrent ? "text-base-content" : "text-base-content/70",
              ].join(" ")}
            >
              {label}
            </span>
          </div>
          {outcome && (
            <p className="text-xs text-base-content/50 truncate mt-0.5">
              {outcome.summary}
            </p>
          )}
        </div>
        {hasDetail && (
          <svg
            className={[
              "size-3.5 text-base-content/30 shrink-0 transition-transform",
              expanded ? "rotate-180" : "",
            ].join(" ")}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </button>

      {expanded && hasDetail && (
        <ul className="ml-10 flex flex-col gap-0.5">
          {outcome!.detail!.map((item, i) => (
            <li
              key={i}
              className="text-xs text-base-content/50 font-mono break-all"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobileStepDots — compact horizontal strip for small screens
// ---------------------------------------------------------------------------

function MobileStepDots({
  pages,
  outcomes,
  currentName,
}: {
  pages: readonly PageDefinition[];
  outcomes: StepOutcome[];
  currentName: string | null;
}) {
  const outcomeMap = new Map(outcomes.map((o) => [o.name, o]));

  return (
    <div className="flex items-center gap-1.5 justify-center py-3 px-4 border-b border-base-200">
      {pages.map((page, i) => {
        const outcome = outcomeMap.get(page.name);
        const isCurrent = page.name === currentName;
        const iconStatus = isCurrent
          ? "current"
          : outcome
            ? outcome.status
            : "pending";
        return (
          <div key={page.name} className="flex items-center gap-1.5">
            <div title={STEP_LABELS[page.name] ?? page.name}>
              <StatusIcon status={iconStatus} />
            </div>
            {i < pages.length - 1 && (
              <div
                className={[
                  "h-px w-4 shrink-0",
                  outcome ? "bg-base-content/30" : "bg-base-200",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportHistoryPanel — left sidebar for desktop, top strip for mobile
// ---------------------------------------------------------------------------

function ReportHistoryPanel() {
  const location = useLocation();
  const completedSteps = use$(completedSteps$) ?? [];

  const outcomeMap = new Map(completedSteps.map((o) => [o.name, o]));

  // Derive which step is currently active from the URL
  const currentName =
    REPORTS.find((p) => pagePath(p.name) === location.pathname)?.name ?? null;

  return (
    <>
      {/* Mobile: horizontal dot strip */}
      <div className="md:hidden">
        <MobileStepDots
          pages={REPORTS}
          outcomes={completedSteps}
          currentName={currentName}
        />
      </div>

      {/* Desktop: left sidebar */}
      <aside className="hidden md:flex flex-col gap-1 w-56 shrink-0 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/30 px-2 mb-1">
          Checks
        </p>
        {REPORTS.map((page, i) => (
          <StepRow
            key={page.name}
            page={page}
            outcome={outcomeMap.get(page.name)}
            isCurrent={page.name === currentName}
            stepNumber={i + 1}
          />
        ))}
      </aside>
    </>
  );
}

export default ReportHistoryPanel;
