import { BehaviorSubject } from "rxjs";
import type { SectionOutcome } from "../pages/reports/accordion-types.ts";

/**
 * The final outcome for each report section, keyed by section name.
 * Populated by ReportAccordionPage as sections complete.
 * Read by the complete page to distinguish completed checks from unresolved ones.
 * Cleared when the user starts over.
 */
export const sectionOutcomes$ = new BehaviorSubject<
  Record<string, SectionOutcome>
>({});

export function hasUnresolvedChecks(outcomes: Record<string, SectionOutcome>) {
  return Object.values(outcomes).some(
    (outcome) => outcome.status !== "clean" && outcome.status !== "fixed",
  );
}
