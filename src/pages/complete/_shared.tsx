// ---------------------------------------------------------------------------
// Shared atoms used across complete/ views
// ---------------------------------------------------------------------------

export function CompleteHeader({ subtitle }: { subtitle: string }) {
  return (
    <div>
      <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
        Complete
      </p>
      <h1 className="text-2xl font-semibold text-base-content">All done</h1>
      <p className="text-sm text-base-content/60 mt-1">{subtitle}</p>
    </div>
  );
}

export function SuccessBadge({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bg-success/10 border border-success/30 rounded-xl p-5 flex flex-col items-center gap-2 text-center">
      <svg
        className="w-8 h-8 text-success"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {children}
    </div>
  );
}
