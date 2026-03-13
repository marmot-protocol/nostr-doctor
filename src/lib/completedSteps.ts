// ---------------------------------------------------------------------------
// completedSteps$ — persistent record of diagnostic step outcomes
//
// Each report page calls recordStep() before calling next(). The BehaviorSubject
// is read by ReportHistoryPanel (sidebar) and the complete/ pages (summary).
// Cleared on handleStartOver() in CompleteView.
// ---------------------------------------------------------------------------

import { BehaviorSubject } from "rxjs";

export type StepStatus = "clean" | "fixed" | "skipped" | "error" | "notfound";

export type StepOutcome = {
  /** Matches REPORTS[n].name */
  name: string;
  /** Human-readable label shown in the panel */
  label: string;
  status: StepStatus;
  /** Short one-line summary, e.g. "2 dead relays removed" */
  summary: string;
  /** Optional bullet-point detail items */
  detail?: string[];
  completedAt: number;
};

export const completedSteps$ = new BehaviorSubject<StepOutcome[]>([]);

/** Append or replace an outcome for the given step name. */
export function recordStep(outcome: StepOutcome): void {
  const current = completedSteps$.getValue();
  const idx = current.findIndex((s) => s.name === outcome.name);
  if (idx === -1) {
    completedSteps$.next([...current, outcome]);
  } else {
    const updated = [...current];
    updated[idx] = outcome;
    completedSteps$.next(updated);
  }
}

/** Reset all recorded steps (called on Start Over). */
export function clearCompletedSteps(): void {
  completedSteps$.next([]);
}
