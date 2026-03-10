import { Component, type ReactNode } from "react";
import { useReport } from "../context/ReportContext.tsx";

// ---------------------------------------------------------------------------
// ReportErrorBoundaryInner — the actual class-based error boundary.
// Class components are required by React for error boundary lifecycle methods.
// ---------------------------------------------------------------------------

type InnerProps = {
  children: ReactNode;
  /** Called when the user presses "Skip" to advance past the crashed report. */
  onSkip: () => void;
  /** Report name shown in the error UI. */
  reportName: string;
};

type InnerState = {
  hasError: boolean;
  error: Error | null;
};

class ReportErrorBoundaryInner extends Component<InnerProps, InnerState> {
  constructor(props: InnerProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): InnerState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleSkip = () => {
    this.setState({ hasError: false, error: null });
    this.props.onSkip();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, reportName } = {
      error: this.state.error,
      reportName: this.props.reportName,
    };

    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-base-100 rounded-2xl border border-error/30 p-8 shadow-sm flex flex-col gap-6">
            {/* Header */}
            <div>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
                {reportName}
              </p>
              <h1 className="text-2xl font-semibold text-error">
                Something went wrong
              </h1>
              <p className="text-sm text-base-content/60 mt-1">
                This report crashed unexpectedly. You can retry or skip to the
                next step.
              </p>
            </div>

            {/* Error detail */}
            {error && (
              <div className="bg-error/10 border border-error/30 rounded-xl p-3 font-mono text-xs text-error break-all">
                {error.message || String(error)}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-primary w-full"
                onClick={this.handleRetry}
              >
                Retry
              </button>
              <button
                className="btn btn-ghost w-full"
                onClick={this.handleSkip}
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

// ---------------------------------------------------------------------------
// ReportErrorBoundary — thin functional wrapper that injects the `next`
// callback from ReportContext into the class-based inner boundary.
// ---------------------------------------------------------------------------

type ReportErrorBoundaryProps = {
  children: ReactNode;
  /** Human-readable label shown in the error UI, e.g. "profile-metadata". */
  reportName: string;
};

function ReportErrorBoundary({
  children,
  reportName,
}: ReportErrorBoundaryProps) {
  const { next } = useReport();
  return (
    <ReportErrorBoundaryInner onSkip={next} reportName={reportName}>
      {children}
    </ReportErrorBoundaryInner>
  );
}

export default ReportErrorBoundary;
