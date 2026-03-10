import { useApp } from '../context/AppContext.tsx'

function Page1() {
  const { subjectUser, next, draftEvents } = useApp()

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          <div>
            <p className="text-xs text-base-content/40 uppercase tracking-widest mb-1">
              Step 1
            </p>
            <h1 className="text-2xl font-semibold text-base-content">
              First diagnostic page
            </h1>
            <p className="text-sm text-base-content/60 mt-1">
              This is a placeholder. Replace with the first real diagnostic step.
            </p>
          </div>

          <div className="bg-base-200 rounded-xl p-4 font-mono text-xs break-all text-base-content/70">
            <span className="text-base-content/40">subject: </span>
            {subjectUser?.pubkey ?? '—'}
          </div>

          {draftEvents.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-warning">
              {draftEvents.length} unsigned event{draftEvents.length !== 1 ? 's' : ''} queued for export
            </div>
          )}

          <button className="btn btn-primary w-full" onClick={next}>
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default Page1
