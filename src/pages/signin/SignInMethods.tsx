import { useNavigate, useLocation } from 'react-router'

const METHODS = [
  {
    id: 'extension',
    label: 'Browser extension',
    description: 'Alby, nos2x, and other NIP-07 extensions',
  },
  {
    id: 'privatekey',
    label: 'Private key',
    description: 'nsec or hex — stored in memory only',
  },
  {
    id: 'password',
    label: 'Encrypted key (NIP-49)',
    description: 'ncryptsec + password',
  },
  {
    id: 'bunker',
    label: 'Nostr Connect — paste URI',
    description: 'bunker:// connection string',
  },
  {
    id: 'nostrconnect',
    label: 'Nostr Connect — scan QR',
    description: 'Scan with Amber, Nsec.app, or similar',
  },
] as const

function SignInMethods() {
  const navigate = useNavigate()
  const location = useLocation()
  const qs = location.search ?? ''

  return (
    <div className="flex flex-col gap-8">
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1 -ml-2 mb-4 text-base-content/40"
          onClick={() => navigate(`/${qs}`)}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-semibold text-base-content">Sign in</h1>
        <p className="mt-1 text-base-content/50 text-sm">Choose a sign-in method.</p>
      </div>

      <div className="flex flex-col">
        {METHODS.map(({ id, label, description }) => (
          <button
            key={id}
            type="button"
            className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity text-left"
            onClick={() => navigate(`/signin/${id}${qs}`)}
          >
            <div>
              <div className="text-sm font-medium text-base-content">{label}</div>
              <div className="text-xs text-base-content/40 mt-0.5">{description}</div>
            </div>
            <svg
              className="w-4 h-4 text-base-content/20 shrink-0 ml-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

export default SignInMethods
