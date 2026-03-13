import { BehaviorSubject } from "rxjs";
import type { SectionOutcome } from "../pages/reports/accordion-types.ts";

/**
 * The final outcome for each report section, keyed by section name.
 * Populated by ReportAccordionPage as sections complete.
 * Read by the complete page to distinguish "genuinely clean" from "skipped issues".
 * Cleared when the user starts over.
 */
export const sectionOutcomes$ = new BehaviorSubject<
  Record<string, SectionOutcome>
>({});
