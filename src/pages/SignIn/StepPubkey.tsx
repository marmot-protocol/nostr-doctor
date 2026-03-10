import type { NostrEvent } from 'applesauce-core/helpers'
import {
  decodeProfilePointer,
  getDisplayName,
  getProfileContent,
  getProfilePicture,
} from 'applesauce-core/helpers'
import { ReadonlyAccount } from 'applesauce-accounts/accounts'
import { isNip05, queryProfile } from 'nostr-tools/nip05'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { manager } from '../../lib/accounts.ts'
import { primal } from '../../lib/primal.ts'

type SearchResult = {
  pubkey: string
  event: NostrEvent
}

type InputMode = 'idle' | 'resolving' | 'searching' | 'error'

/** True if the string is a direct nip-19 or hex identifier — no network needed */
function isDirectIdentifier(value: string): boolean {
  const t = value.trim()
  return (
    t.startsWith('npub1') ||
    t.startsWith('nprofile1') ||
    /^[0-9a-f]{64}$/i.test(t)
  )
}

function ResultItem({
  result,
  onSelect,
}: {
  result: SearchResult
  onSelect: (pubkey: string) => void
}) {
  const profile = getProfileContent(result.event)
  const name = getDisplayName(profile, result.pubkey.slice(0, 8))
  const avatar = getProfilePicture(profile, `https://robohash.org/${result.pubkey}.png`)

  return (
    <button
      type="button"
      className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-base-200 transition-colors text-left"
      onClick={() => onSelect(result.pubkey)}
    >
      <img
        src={avatar}
        alt={name}
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-base-300"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).src = `https://robohash.org/${result.pubkey}.png`
        }}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-base-content truncate">{name}</div>
        <div className="text-xs text-base-content/40 font-mono truncate">
          {result.pubkey.slice(0, 16)}…
        </div>
      </div>
    </button>
  )
}

function StepPubkey() {
  const navigate = useNavigate()

  const [value, setValue] = useState('')
  const [resolvedPubkey, setResolvedPubkey] = useState('')
  const [mode, setMode] = useState<InputMode>('idle')
  const [error, setError] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-navigate as soon as a pubkey is resolved (direct identifiers, NIP-05)
  useEffect(() => {
    if (!resolvedPubkey) return
    const account = ReadonlyAccount.fromPubkey(resolvedPubkey)
    manager.addAccount(account)
    manager.setActive(account)
    navigate('/page/1')
  }, [resolvedPubkey, navigate])

  // Kick off async resolution whenever value changes.
  // Synchronous state resets happen in handleChange to avoid setState-in-effect.
  useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed || isDirectIdentifier(trimmed)) return

    debounceRef.current = setTimeout(async () => {
      if (isNip05(trimmed)) {
        setMode('resolving')
        try {
          const pointer = await queryProfile(trimmed)
          if (pointer) {
            setResolvedPubkey(pointer.pubkey)
            setMode('idle')
          } else {
            setError(`Could not resolve "${trimmed}" — check the NIP-05 address.`)
            setMode('error')
          }
        } catch {
          setError('NIP-05 lookup failed. Check the address and try again.')
          setMode('error')
        }
      } else {
        setMode('searching')
        try {
          const events = await primal.userSearch(trimmed, 8)
          const results: SearchResult[] = events
            .filter((e) => e.kind === 0)
            .map((e) => ({ pubkey: e.pubkey, event: e }))
          setSearchResults(results)
          setShowDropdown(results.length > 0)
          setMode('idle')
        } catch {
          setError('Search failed. Try again or paste a pubkey directly.')
          setMode('error')
        }
      }
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  function handleChange(newValue: string) {
    setValue(newValue)
    // Reset derived state synchronously in the event handler (not inside an effect)
    setError('')
    setResolvedPubkey('')
    setSearchResults([])
    setShowDropdown(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = newValue.trim()
    if (!trimmed) {
      setMode('idle')
      return
    }

    if (isDirectIdentifier(trimmed)) {
      const pointer = decodeProfilePointer(trimmed)
      if (pointer) {
        setResolvedPubkey(pointer.pubkey)
        setMode('idle')
      } else {
        setError('Could not decode that identifier.')
        setMode('error')
      }
    }
    // async paths (NIP-05, Primal) are handled by the effect above
  }

  function handleSelectResult(pubkey: string) {
    const result = searchResults.find((r) => r.pubkey === pubkey)
    if (result) {
      const profile = getProfileContent(result.event)
      setValue(getDisplayName(profile, pubkey.slice(0, 8)))
    }
    setShowDropdown(false)
    setSearchResults([])
    // Setting resolvedPubkey triggers the auto-navigate effect above
    setResolvedPubkey(pubkey)
  }

  const isLoading = mode === 'resolving' || mode === 'searching'

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-base-content">Who are we diagnosing?</h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Search by name, or paste an npub, NIP-05, or hex pubkey.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <input
            type="text"
            className={[
              'input input-bordered w-full pr-10 font-mono text-sm',
              error ? 'input-error' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            placeholder="npub1… or search by name"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            onFocus={() => { if (searchResults.length > 0) setShowDropdown(true) }}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />

          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {isLoading && (
              <span className="loading loading-spinner loading-xs text-base-content/40" />
            )}
          </div>

          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-base-100 border border-base-300 rounded-xl shadow-lg overflow-hidden">
              {searchResults.map((result) => (
                <ResultItem key={result.pubkey} result={result} onSelect={handleSelectResult} />
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-error text-sm">{error}</p>}
        {mode === 'resolving' && (
          <p className="text-base-content/40 text-sm">Resolving NIP-05…</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-base-content/30 text-center">or</p>
        <button
          type="button"
          className="btn btn-ghost btn-sm w-full text-base-content/50"
          onClick={() => navigate('/signin')}
        >
          Sign in with your own key
        </button>
      </div>
    </div>
  )
}

export default StepPubkey
