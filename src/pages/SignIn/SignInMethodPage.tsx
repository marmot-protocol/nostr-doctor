import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  ExtensionMissingError,
  NostrConnectSigner,
  PasswordSigner,
  PrivateKeySigner,
} from 'applesauce-signers/signers'
import {
  ExtensionAccount,
  NostrConnectAccount,
  PasswordAccount,
  PrivateKeyAccount,
} from 'applesauce-accounts/accounts'
import { qrcode } from '@libs/qrcode'
import { manager } from '../../lib/accounts.ts'
import { DEFAULT_RELAYS, pool } from '../../lib/relay.ts'

// Wire NostrConnectSigner to use our shared RelayPool once at module load
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool)
NostrConnectSigner.publishMethod = pool.publish.bind(pool)

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type SignedInHandler = () => void

function addAndActivate(
  account:
    | ExtensionAccount
    | PrivateKeyAccount
    | PasswordAccount
    | NostrConnectAccount,
) {
  manager.addAccount(account)
  manager.setActive(account)
}

// ---------------------------------------------------------------------------
// Back button
// ---------------------------------------------------------------------------

function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm gap-1 -ml-2 mb-4 text-base-content/40"
      onClick={() => navigate('/signin')}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  )
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

function ExtensionMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    setLoading(true)
    setError('')
    try {
      const account = await ExtensionAccount.fromExtension()
      addAndActivate(account)
      onSignedIn()
    } catch (err) {
      if (err instanceof ExtensionMissingError) {
        setError('No Nostr browser extension found. Install one (e.g. Alby, nos2x) and try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">Browser extension</h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Connect using a NIP-07 browser extension like Alby or nos2x. Your
          private key never leaves the extension.
        </p>
      </div>
      {error && <p className="text-error text-sm">{error}</p>}
      <button className="btn btn-primary w-full" onClick={connect} disabled={loading}>
        {loading ? <span className="loading loading-spinner loading-sm" /> : 'Connect extension'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Private key
// ---------------------------------------------------------------------------

function PrivateKeyMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const signer = PrivateKeySigner.fromKey(value.trim())
      const pubkey = await signer.getPublicKey()
      const account = new PrivateKeyAccount(pubkey, signer)
      addAndActivate(account)
      onSignedIn()
    } catch {
      setError('Invalid private key. Enter a valid nsec or hex key.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">Private key</h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Paste your nsec or hex private key. It is held in memory only and
          never sent anywhere.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="password"
          className={`input input-bordered w-full font-mono text-sm${error ? ' input-error' : ''}`}
          placeholder="nsec1… or hex private key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'Sign in'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Encrypted key (NIP-49)
// ---------------------------------------------------------------------------

function PasswordMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [ncryptsec, setNcryptsec] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const signer = await PasswordSigner.fromNcryptsec(ncryptsec.trim(), password)
      const pubkey = await signer.getPublicKey()
      const account = new PasswordAccount(pubkey, signer)
      addAndActivate(account)
      onSignedIn()
    } catch {
      setError('Failed to decrypt. Check your ncryptsec and password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">Encrypted key (NIP-49)</h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Paste your <span className="font-mono text-xs">ncryptsec</span> and
          the password used to encrypt it.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="text"
          className={`input input-bordered w-full font-mono text-sm${error ? ' input-error' : ''}`}
          placeholder="ncryptsec1…"
          value={ncryptsec}
          onChange={(e) => setNcryptsec(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        <input
          type="password"
          className="input input-bordered w-full"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'Unlock & sign in'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Bunker (NIP-46 paste)
// ---------------------------------------------------------------------------

function BunkerMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [uri, setUri] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const signer = await NostrConnectSigner.fromBunkerURI(uri.trim())
      const pubkey = await signer.getPublicKey()
      const account = new NostrConnectAccount(pubkey, signer)
      addAndActivate(account)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to bunker.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">Nostr Connect</h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Paste the <span className="font-mono text-xs">bunker://</span> URI
          from your remote signer (e.g. nsecBunker, Citrine).
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="text"
          className={`input input-bordered w-full font-mono text-sm${error ? ' input-error' : ''}`}
          placeholder="bunker://…"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'Connect'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Nostr Connect QR
// ---------------------------------------------------------------------------

function NostrConnectMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [svgMarkup, setSvgMarkup] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let signerInstance: NostrConnectSigner | null = null

    async function init() {
      try {
        signerInstance = new NostrConnectSigner({ relays: DEFAULT_RELAYS })
        const uri = signerInstance.getNostrConnectURI({ name: 'Nostr Doctor' })
        if (cancelled) return
        setSvgMarkup(qrcode(uri, { output: 'svg' }))
        await signerInstance.waitForSigner()
        if (cancelled) return
        const pubkey = await signerInstance.getPublicKey()
        if (cancelled) return
        const account = new NostrConnectAccount(pubkey, signerInstance)
        addAndActivate(account)
        onSignedIn()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Connection failed.')
      }
    }

    init()
    return () => {
      cancelled = true
      signerInstance?.close()
    }
  // onSignedIn is stable (defined in parent render), safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">Nostr Connect — QR</h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Scan with your Nostr signer app (e.g. Amber, Nsec.app).
        </p>
      </div>

      {error && <p className="text-error text-sm">{error}</p>}

      {!error && !svgMarkup && (
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg" />
        </div>
      )}

      {svgMarkup && (
        <div className="flex flex-col items-center gap-4">
          <div
            className="rounded-xl overflow-hidden border border-base-300"
            style={{ width: 220, height: 220 }}
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
          <p className="text-sm text-base-content/40">Waiting for approval…</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Router entry point — reads :method param and renders the right form
// ---------------------------------------------------------------------------

const METHOD_IDS = ['extension', 'privatekey', 'password', 'bunker', 'nostrconnect'] as const
type MethodId = (typeof METHOD_IDS)[number]

function isMethodId(v: string): v is MethodId {
  return (METHOD_IDS as readonly string[]).includes(v)
}

function SignInMethodPage() {
  const { method } = useParams<{ method: string }>()
  const navigate = useNavigate()

  function handleSignedIn() {
    navigate('/page/1')
  }

  if (!method || !isMethodId(method)) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-error text-sm">Unknown sign-in method.</p>
        <button className="btn btn-ghost w-full" onClick={() => navigate('/signin')}>
          Back to sign-in options
        </button>
      </div>
    )
  }

  return (
    <>
      {method === 'extension' && <ExtensionMethod onSignedIn={handleSignedIn} />}
      {method === 'privatekey' && <PrivateKeyMethod onSignedIn={handleSignedIn} />}
      {method === 'password' && <PasswordMethod onSignedIn={handleSignedIn} />}
      {method === 'bunker' && <BunkerMethod onSignedIn={handleSignedIn} />}
      {method === 'nostrconnect' && <NostrConnectMethod onSignedIn={handleSignedIn} />}
    </>
  )
}

export default SignInMethodPage
