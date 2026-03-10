import { useNavigate } from 'react-router'
import { ReadonlyAccount } from 'applesauce-accounts/accounts'
import { useApp } from '../../context/AppContext.tsx'
import { manager } from '../../lib/accounts.ts'

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
  const { subjectUser, setSubject } = useApp()

  function handleReadOnly() {
    if (!subjectUser) return
    const account = ReadonlyAccount.fromPubkey(subjectUser.pubkey)
    manager.addAccount(account)
    manager.setActive(account)
    navigate('/page/1')
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1 -ml-2 mb-3 text-base-content/50"
          onClick={() => navigate('/')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-semibold text-base-content">Sign in</h1>
        {subjectUser ? (
          <p className="mt-1 text-base-content/60 text-sm">
            Inspecting{' '}
            <span className="font-mono bg-base-200 px-1 py-0.5 rounded">
              {subjectUser.pubkey.slice(0, 16)}…
            </span>
            . Sign in to apply fixes.
          </p>
        ) : (
          <p className="mt-1 text-base-content/60 text-sm">
            Choose how you want to sign in.
          </p>
        )}
      </div>

      <div className="flex flex-col divide-y divide-base-200 border border-base-200 rounded-xl overflow-hidden">
        {METHODS.map(({ id, label, description }) => (
          <button
            key={id}
            type="button"
            className="flex items-center justify-between px-4 py-3.5 bg-base-100 hover:bg-base-200 transition-colors text-left"
            onClick={() => {
              // If arriving directly (no subject), clear it so sign-in sets it
              if (!subjectUser) setSubject('')
              navigate(`/signin/${id}`)
            }}
          >
            <div>
              <div className="text-sm font-medium text-base-content">{label}</div>
              <div className="text-xs text-base-content/50 mt-0.5">{description}</div>
            </div>
            <svg
              className="w-4 h-4 text-base-content/30 shrink-0 ml-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>

      {subjectUser && (
        <>
          <div className="divider text-sm text-base-content/40 my-0">or</div>
          <button type="button" className="btn btn-ghost w-full" onClick={handleReadOnly}>
            Continue read-only
          </button>
        </>
      )}
    </div>
  )
}

export default SignInMethods
