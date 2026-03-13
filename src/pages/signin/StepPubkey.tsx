import type { NostrEvent } from "applesauce-core/helpers";
import {
  decodeProfilePointer,
  getDisplayName,
  getProfileContent,
  getProfilePicture,
} from "applesauce-core/helpers";
import { isNip05, queryProfile } from "nostr-tools/nip05";
import { npubEncode } from "nostr-tools/nip19";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { getSafeRedirect, REPORT_PAGE_BASE } from "../../lib/routing.ts";
import { subjectPubkey$ } from "../../lib/subjectPubkey.ts";
import { primal } from "../../lib/primal.ts";
import { eventLoader, eventStore } from "../../lib/store.ts";

type SearchResult = {
  pubkey: string;
  event: NostrEvent;
};

type InputMode = "idle" | "resolving" | "searching" | "error";

/** True if the string is a direct nip-19 or hex identifier — no network needed */
function isDirectIdentifier(value: string): boolean {
  const t = value.trim();
  return (
    t.startsWith("npub1") ||
    t.startsWith("nprofile1") ||
    /^[0-9a-f]{64}$/i.test(t)
  );
}

function ResultItem({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (pubkey: string) => void;
}) {
  const profile = getProfileContent(result.event);
  const name = getDisplayName(profile, result.pubkey.slice(0, 8));
  const avatar = getProfilePicture(
    profile,
    `https://robohash.org/${result.pubkey}.png`,
  );

  return (
    <button
      type="button"
      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-base-200 active:bg-base-300 transition-colors text-left"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(result.pubkey)}
    >
      <img
        src={avatar}
        alt={name}
        className="w-8 h-8 rounded-full object-cover shrink-0 bg-base-300"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src =
            `https://robohash.org/${result.pubkey}.png`;
        }}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-base-content truncate">
          {name}
        </div>
        <div className="text-xs text-base-content/40 font-mono truncate">
          {npubEncode(result.pubkey)}
        </div>
      </div>
    </button>
  );
}

function StepPubkey() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = getSafeRedirect(location.search);

  const [value, setValue] = useState("");
  const [resolvedPubkey, setResolvedPubkey] = useState("");
  const [mode, setMode] = useState<InputMode>("idle");
  const [error, setError] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [inputFocused, setInputFocused] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Set to true after a result is selected — prevents the value-change effect
  // from firing a redundant Primal search when we set the display name.
  const resultSelectedRef = useRef(false);
  const prefetchedRef = useRef<string | null>(null);

  /**
   * Eagerly fetch kind:0 and kind:10002 for a pubkey so they land in the
   * event store before the accordion page mounts. Each eventLoader call is
   * fire-and-forget — we subscribe once and immediately unsubscribe; the
   * address loader's batchLoader will still complete the request and add the
   * event to the store via filterDuplicateEvents / mapEventsToStore.
   */
  function prefetchForPubkey(pubkey: string) {
    if (prefetchedRef.current === pubkey) return;
    prefetchedRef.current = pubkey;
    // kind:0 — profile metadata (first section, must load fast)
    eventLoader({ kind: 0, pubkey }).subscribe();
    // kind:10002 — relay list (outboxes used by every other loader)
    eventLoader({ kind: 10002, pubkey }).subscribe();
  }

  /** Commit subject and navigate — only on explicit user action (button click). */
  function handleContinue() {
    if (!resolvedPubkey) return;
    subjectPubkey$.next(resolvedPubkey);
    navigate(redirectTo ?? REPORT_PAGE_BASE);
  }

  // Kick off async resolution whenever value changes.
  // Synchronous state resets happen in handleChange to avoid setState-in-effect.
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed || isDirectIdentifier(trimmed)) return;
    // Skip search if a result was just selected — value was set to display name
    if (resultSelectedRef.current) {
      resultSelectedRef.current = false;
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (isNip05(trimmed)) {
        setMode("resolving");
        try {
          const pointer = await queryProfile(trimmed);
          if (pointer) {
            prefetchForPubkey(pointer.pubkey);
            setResolvedPubkey(pointer.pubkey);
            setMode("idle");
          } else {
            setError(
              `Could not resolve "${trimmed}" — check the NIP-05 address.`,
            );
            setMode("error");
          }
        } catch {
          setError("NIP-05 lookup failed. Check the address and try again.");
          setMode("error");
        }
      } else {
        setMode("searching");
        try {
          const events = await primal.userSearch(trimmed, 8);
          // Seed the event store with search results so the profile-metadata
          // loader gets an immediate cache hit instead of going to relays cold.
          for (const e of events) eventStore.add(e);
          const results: SearchResult[] = events
            .filter((e) => e.kind === 0)
            .map((e) => ({ pubkey: e.pubkey, event: e }));
          setSearchResults(results);
          setMode("idle");
        } catch {
          setError("Search failed. Try again or paste a pubkey directly.");
          setMode("error");
        }
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  function handleChange(newValue: string) {
    setValue(newValue);
    // Reset derived state synchronously in the event handler (not inside an effect)
    setError("");
    setResolvedPubkey("");
    setSearchResults([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = newValue.trim();
    if (!trimmed) {
      setMode("idle");
      return;
    }

    if (isDirectIdentifier(trimmed)) {
      const pointer = decodeProfilePointer(trimmed);
      if (pointer) {
        prefetchForPubkey(pointer.pubkey);
        setResolvedPubkey(pointer.pubkey);
        setMode("idle");
      } else {
        setError("Could not decode that identifier.");
        setMode("error");
      }
    }
    // async paths (NIP-05, Primal) are handled by the effect above
  }

  function handleSelectResult(pubkey: string) {
    const result = searchResults.find((r) => r.pubkey === pubkey);
    if (result) {
      const profile = getProfileContent(result.event);
      resultSelectedRef.current = true;
      setValue(getDisplayName(profile, pubkey.slice(0, 8)));
    }
    prefetchForPubkey(pubkey);
    setResolvedPubkey(pubkey);
    inputRef.current?.blur();
  }

  const isLoading = mode === "resolving" || mode === "searching";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-base-content">
          Who are we diagnosing?
        </h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Search by name, or paste an npub, NIP-05, or hex pubkey.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            className={[
              "input input-bordered w-full pr-10 font-mono text-sm",
              error ? "input-error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            placeholder="npub1… or search by name"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && resolvedPubkey) handleContinue();
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />

          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {isLoading && (
              <span className="loading loading-spinner loading-xs text-base-content/40" />
            )}
          </div>
        </div>

        {inputFocused && searchResults.length > 0 && (
          <div className="flex flex-col divide-y divide-base-300 rounded-xl border border-base-300 overflow-hidden">
            {searchResults.map((result) => (
              <ResultItem
                key={result.pubkey}
                result={result}
                onSelect={handleSelectResult}
              />
            ))}
          </div>
        )}

        {error && <p className="text-error text-sm">{error}</p>}
        {mode === "resolving" && (
          <p className="text-base-content/40 text-sm">Resolving NIP-05…</p>
        )}
        {resolvedPubkey && (
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={handleContinue}
          >
            Continue
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-base-content/30 text-center">or</p>
        <button
          type="button"
          className="btn btn-ghost btn-sm w-full text-base-content/50"
          onClick={() => {
            const qs = location.search ? `${location.search}` : "";
            navigate(`/signin${qs}`);
          }}
        >
          Sign in with your own key
        </button>
      </div>
    </div>
  );
}

export default StepPubkey;
