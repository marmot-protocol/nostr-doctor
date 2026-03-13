// ---------------------------------------------------------------------------
// Types shared between the accordion runner and individual report sections.
// ---------------------------------------------------------------------------

import type { ComponentType } from "react";
import type { IAccount } from "applesauce-accounts";
import type { User } from "applesauce-common/casts";
import type { Observable } from "rxjs";
import type { LoaderState } from "./loader-types.ts";

export type SectionStatus =
  | "clean"
  | "fixed"
  | "skipped"
  | "notfound"
  | "error";

export type SectionOutcome = {
  status: SectionStatus;
  /** Short one-line summary shown in the collapsed accordion header */
  summary: string;
  /** Optional expandable bullet items */
  detail?: string[];
};

/**
 * Props passed to each report section's content component.
 *
 * The loader has already been run by the accordion runner — the component
 * receives the result as `loaderState` and never re-runs the loader itself.
 * This means reopening a closed accordion shows the cached result instantly.
 *
 * - `subject`     — the user being diagnosed
 * - `account`     — the signed-in account, or null in read-only mode
 * - `publish`     — fire-and-forget publish (same as ReportContext.publish).
 *                   When account is null, queues into draftEvents$ silently —
 *                   sections should show a read-only banner in that case.
 * - `loaderState` — the live LoaderState<TState> from the hoisted loader
 * - `onDone`        — call when the section has a final result (does NOT advance)
 * - `onContinue`    — call when the user explicitly clicks Continue/Done/Next
 *                     (advances the accordion to the next section)
 * - `isActive`      — true when this is the currently active section
 * - `isDoneSection` — true when the section is done and being reviewed (not active).
 *                     Sections should hide their Continue button in this state —
 *                     the user is just reviewing past results, not re-advancing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SectionProps<TState = any> = {
  subject: User;
  account: IAccount | null;
  publish: (
    template: import("applesauce-core/helpers").EventTemplate,
  ) => Promise<void>;
  loaderState: LoaderState<TState> | undefined;
  onDone: (outcome: SectionOutcome) => void;
  onContinue: () => void;
  isActive: boolean;
  /** True when this section is done and being reviewed (not the active step). Hide Continue here. */
  isDoneSection: boolean;
};

/**
 * Each section definition ties together:
 * - A name/label/description for the accordion header
 * - A `createLoader` function that creates the Observable for this section
 * - A `Component` that receives `SectionProps` and renders the section body
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportSectionDefinition<TState = any> = {
  name: string;
  label: string;
  description: string;
  createLoader: (user: User) => Observable<TState>;
  Component: ComponentType<SectionProps<TState>>;
};
