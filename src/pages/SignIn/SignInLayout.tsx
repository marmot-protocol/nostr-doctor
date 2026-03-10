import { Outlet } from 'react-router'

function SignInLayout() {
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Wordmark */}
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-base-content">
            nostr.doctor
          </h2>
          <p className="text-sm text-base-content/50 mt-1">
            Diagnose and fix common Nostr issues
          </p>
        </div>

        {/* Card */}
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default SignInLayout
