import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { use$ } from "applesauce-react/hooks";
import { timer } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { toLoaderState } from "../../observable/operator/to-loader-state.ts";
import { useReport } from "../../context/ReportContext.tsx";
import { EVENT_LOAD_TIMEOUT_MS } from "../../lib/timeouts.ts";
import { sectionOutcomes$ } from "../../lib/sectionOutcomes.ts";
import doctorLogo from "../../assets/nostr-doctor.webp";
import Footer from "../../components/Footer.tsx";
import type { LoaderState } from "./loader-types.ts";
import type {
  ReportSectionDefinition,
  SectionOutcome,
  SectionStatus,
} from "./accordion-types.ts";
import type { User } from "applesauce-common/casts";
import REPORT_SECTIONS from "./sections.tsx";

// ---------------------------------------------------------------------------
// SectionLoader — always-mounted component that runs one loader.
//
// This component never unmounts while the accordion page is alive, so the
// loader subscription persists regardless of whether the accordion body is
// open or closed. It reports the latest loaderState upward via onStateChange.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionLoader<TState = any>({
  section,
  subject,
  index,
  onStateChange,
}: {
  section: ReportSectionDefinition<TState>;
  subject: User;
  /** Section index — index 0 starts immediately; others are staggered to give
   *  the first (active) section priority access to relay connections. */
  index: number;
  onStateChange: (state: LoaderState<TState> | undefined) => void;
}) {
  // Delay non-first loaders so the profile-metadata section (index 0) gets
  // a head start on relay connections. 800 ms is enough for the first REQ to
  // go out and receive an EOSE before the rest pile in.
  const [ready, setReady] = useState(index === 0);

  useEffect(() => {
    if (index === 0) return;
    const t = setTimeout(() => setReady(true), 800);
    return () => clearTimeout(t);
  }, [index]);

  const loaderState = use$(
    () => {
      if (!ready) return undefined;
      return section
        .createLoader(subject)
        .pipe(takeUntil(timer(EVENT_LOAD_TIMEOUT_MS)), toLoaderState());
    },
    // Re-create only if subject or readiness changes
    [subject.pubkey, section.name, ready],
  );

  // Report state upward on every change
  useEffect(() => {
    onStateChange(loaderState as LoaderState<TState> | undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderState]);

  return null; // renders nothing — purely a side-effect holder
}

// ---------------------------------------------------------------------------
// Status icon shown in collapsed accordion headers
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
}: {
  status: SectionStatus | "active" | "pending";
}) {
  if (status === "active") {
    return (
      <span className="size-5 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="size-5 rounded-full border-2 border-base-300 shrink-0" />
    );
  }
  if (status === "clean" || status === "fixed") {
    const color =
      status === "fixed"
        ? "bg-primary/20 text-primary"
        : "bg-success/20 text-success";
    return (
      <span
        className={[
          "size-5 rounded-full flex items-center justify-center shrink-0",
          color,
        ].join(" ")}
      >
        <svg
          className="size-3"
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
// Accordion state — single reducer so all updates are atomic.
//
// Key UX rules encoded here:
//  - Only ONE section is open at a time (openIndex is exclusive)
//  - Pending sections cannot be opened; clicking them pulses the active section
//  - Done sections can be opened freely, closing whatever was open before
//  - The active section can be toggled open/closed by clicking its header
//  - Advancing (continue) closes the current section and opens the next
// ---------------------------------------------------------------------------

type AccordionState = {
  /** Index of the currently active (running) section. REPORT_SECTIONS.length = all done. */
  activeIndex: number;
  /** Per-section outcome — null means not yet done */
  outcomes: (SectionOutcome | null)[];
  /** Which section body is open, or null if all collapsed */
  openIndex: number | null;
};

type AccordionAction =
  | { type: "done"; index: number; outcome: SectionOutcome }
  | { type: "continue"; index: number }
  | { type: "open"; index: number }
  | { type: "pulse-active" }; // used externally to trigger pulse, no state change

function accordionReducer(
  state: AccordionState,
  action: AccordionAction,
): AccordionState {
  switch (action.type) {
    case "done": {
      // Only record the outcome — do NOT collapse or advance.
      const outcomes = [...state.outcomes];
      outcomes[action.index] = action.outcome;
      return { ...state, outcomes };
    }

    case "continue": {
      const { index } = action;
      // Only advance if this section is the currently active one
      if (index !== state.activeIndex) return state;

      const nextIndex = index + 1;

      if (nextIndex < REPORT_SECTIONS.length) {
        // Open the next section, close the current one
        return {
          activeIndex: nextIndex,
          outcomes: state.outcomes,
          openIndex: nextIndex,
        };
      } else {
        // All done — collapse everything
        return {
          activeIndex: REPORT_SECTIONS.length,
          outcomes: state.outcomes,
          openIndex: null,
        };
      }
    }

    case "open": {
      const { index } = action;
      // Toggle: if already open, close it; otherwise open it exclusively
      if (state.openIndex === index) {
        return { ...state, openIndex: null };
      }
      return { ...state, openIndex: index };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// ReportAccordionPage — single page running all checks
// ---------------------------------------------------------------------------

function ReportAccordionPage() {
  const { subject, account, publish } = useReport();
  const navigate = useNavigate();

  const [{ activeIndex, outcomes, openIndex }, dispatch] = useReducer(
    accordionReducer,
    undefined,
    (): AccordionState => ({
      activeIndex: 0,
      outcomes: REPORT_SECTIONS.map(() => null),
      openIndex: 0, // start with the first section open
    }),
  );

  // Loader states for all sections — updated by SectionLoader components.
  const [loaderStates, setLoaderStates] = useState<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (LoaderState<any> | undefined)[]
  >(() => REPORT_SECTIONS.map(() => undefined));

  // Ref for the active section card — used to scroll-to and pulse it
  const sectionRefs = useRef<(HTMLDivElement | null)[]>(
    REPORT_SECTIONS.map(() => null),
  );

  // Which section is currently pulsing (locked-click feedback)
  const [pulsingIndex, setPulsingIndex] = useState<number | null>(null);

  if (!subject) return null;

  function handleStateChange(
    index: number,
    state: LoaderState<unknown> | undefined,
  ) {
    setLoaderStates((prev) => {
      const next = [...prev];
      next[index] = state;
      return next;
    });
  }

  function handleDone(index: number, outcome: SectionOutcome) {
    dispatch({ type: "done", index, outcome });
    const name = REPORT_SECTIONS[index].name;
    sectionOutcomes$.next({ ...sectionOutcomes$.getValue(), [name]: outcome });
  }

  function handleContinue(index: number) {
    dispatch({ type: "continue", index });
  }

  function handleHeaderClick(index: number) {
    const outcome = outcomes[index];
    const isDone = outcome !== null;
    const isActive = index === activeIndex;
    const isPending = !isActive && !isDone;

    if (isPending) {
      // Flash the active section to draw attention — cannot skip ahead
      setPulsingIndex(activeIndex);
      sectionRefs.current[activeIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      setTimeout(() => setPulsingIndex(null), 700);
      return;
    }

    // Done or active sections can be opened/closed freely
    dispatch({ type: "open", index });
  }

  const allDone = activeIndex >= REPORT_SECTIONS.length;

  return (
    <div className="min-h-screen bg-base-200 py-8 px-4 flex flex-col">
      {/* Always-mounted SectionLoader components — invisible, keep loaders alive */}
      <div style={{ display: "none" }}>
        {REPORT_SECTIONS.map((section, i) => (
          <SectionLoader
            key={section.name}
            section={section}
            subject={subject}
            index={i}
            onStateChange={(state) => handleStateChange(i, state)}
          />
        ))}
      </div>

      <div className="w-full max-w-2xl mx-auto flex flex-col gap-3">
        {/* Page header */}
        <div className="mb-2 flex flex-col items-center text-center gap-4">
          <Link to="/">
            <img
              src={doctorLogo}
              alt="Nostr Doctor logo"
              className="w-40 h-auto sm:w-44"
            />
          </Link>
          <Link to="/" className="hover:opacity-80 transition-opacity">
            <h1 className="text-2xl font-semibold text-base-content">
              Account Diagnostics
            </h1>
          </Link>
          <p className="text-sm text-base-content/60 max-w-md">
            Running {REPORT_SECTIONS.length} checks on your Nostr account.
          </p>
        </div>

        {/* Accordion sections */}
        {REPORT_SECTIONS.map((section, i) => {
          const outcome = outcomes[i];
          const isActive = i === activeIndex;
          const isDone = outcome !== null;
          const isOpen = openIndex === i;
          const isPending = !isActive && !isDone;
          const isPulsing = pulsingIndex === i;
          const loaderState = loaderStates[i];
          const isLoading = !loaderState?.complete;

          const iconStatus: SectionStatus | "active" | "pending" = isActive
            ? "active"
            : isDone
              ? outcome.status
              : "pending";

          return (
            <div
              key={section.name}
              ref={(el) => {
                sectionRefs.current[i] = el;
              }}
              className={[
                "rounded-2xl border bg-base-100 transition-all duration-200",
                isActive
                  ? "border-primary/50 shadow-md"
                  : isDone
                    ? "border-base-content/15"
                    : "border-base-content/10 opacity-60",
                isPulsing ? "animate-pulse" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {/* Accordion header */}
              <button
                className={[
                  "w-full flex items-center gap-3 px-5 py-4 text-left rounded-2xl transition-colors",
                  !isPending
                    ? "hover:bg-base-200/40 cursor-pointer"
                    : "cursor-default",
                ].join(" ")}
                onClick={() => handleHeaderClick(i)}
                aria-expanded={isOpen}
              >
                {isActive && isLoading && !isDone ? (
                  <span className="loading loading-spinner loading-xs text-primary shrink-0" />
                ) : (
                  <StatusIcon status={iconStatus} />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={[
                        "text-sm font-semibold",
                        isPending
                          ? "text-base-content/40"
                          : "text-base-content",
                      ].join(" ")}
                    >
                      {section.label}
                    </span>
                    {isDone && (
                      <span className="text-xs text-base-content/50">
                        {outcome.summary}
                      </span>
                    )}
                    {(isActive || isPending) && !isDone && (
                      <span
                        className={[
                          "text-xs",
                          isPending
                            ? "text-base-content/30"
                            : "text-base-content/40",
                        ].join(" ")}
                      >
                        {section.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* Chevron — only shown when clickable (active or done) */}
                {!isPending && (
                  <svg
                    className={[
                      "size-4 text-base-content/30 shrink-0 transition-transform duration-200",
                      isOpen ? "rotate-180" : "",
                    ].join(" ")}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                )}
              </button>

              {/* Accordion body — always mounted to preserve local state;
                  hidden with CSS when collapsed so React state survives open/close */}
              <div
                className={[
                  "border-t border-base-content/10",
                  isOpen ? "" : "hidden",
                ].join(" ")}
              >
                <div className="px-5 pb-5 pt-1">
                  <section.Component
                    subject={subject}
                    account={account}
                    publish={publish}
                    loaderState={loaderState}
                    onDone={(o) => handleDone(i, o)}
                    onContinue={() => handleContinue(i)}
                    isActive={isActive}
                    isDoneSection={isDone && !isActive}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* Finish button */}
        {allDone && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="bg-success/10 border border-success/30 rounded-2xl p-5 text-center">
              <p className="text-sm font-medium text-base-content">
                All checks complete
              </p>
              <p className="text-xs text-base-content/50 mt-1">
                Review the results above, then continue to see your summary.
              </p>
            </div>
            <button
              className="btn btn-primary w-full"
              onClick={() => navigate("/complete", { replace: true })}
            >
              View Summary
            </button>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}

export default ReportAccordionPage;
