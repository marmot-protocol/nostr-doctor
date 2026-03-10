import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { getSafeRedirect, REPORT_PAGE_BASE } from "../../lib/routing.ts";
import {
  NostrConnectSigner,
  PasswordSigner,
  PrivateKeySigner,
} from "applesauce-signers/signers";
import {
  NostrConnectAccount,
  PasswordAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { manager } from "../../lib/accounts.ts";
import { pool } from "../../lib/relay.ts";

// Wire NostrConnectSigner to use our shared RelayPool once at module load
NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
NostrConnectSigner.publishMethod = pool.publish.bind(pool);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type SignedInHandler = () => void;

function addAndActivate(
  account: PrivateKeyAccount | PasswordAccount | NostrConnectAccount,
) {
  manager.addAccount(account);
  manager.setActive(account);
}

// ---------------------------------------------------------------------------
// Back button (preserves redirect query)
// ---------------------------------------------------------------------------

function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const qs = location.search ?? "";
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm gap-1 -ml-2 mb-4 text-base-content/40"
      onClick={() => navigate(`/signin${qs}`)}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 19l-7-7 7-7"
        />
      </svg>
      Back
    </button>
  );
}

// ---------------------------------------------------------------------------
// Private key
// ---------------------------------------------------------------------------

function PrivateKeyMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const signer = PrivateKeySigner.fromKey(value.trim());
      const pubkey = await signer.getPublicKey();
      const account = new PrivateKeyAccount(pubkey, signer);
      addAndActivate(account);
      onSignedIn();
    } catch {
      setError("Invalid private key. Enter a valid nsec or hex key.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">
          Private key
        </h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Paste your nsec or hex private key. It is held in memory only and
          never sent anywhere.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="password"
          className={`input input-bordered w-full font-mono text-sm${error ? " input-error" : ""}`}
          placeholder="nsec1… or hex private key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={loading}
        >
          {loading ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            "Sign in"
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Encrypted key (NIP-49)
// ---------------------------------------------------------------------------

function PasswordMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [ncryptsec, setNcryptsec] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const signer = await PasswordSigner.fromNcryptsec(
        ncryptsec.trim(),
        password,
      );
      const pubkey = await signer.getPublicKey();
      const account = new PasswordAccount(pubkey, signer);
      addAndActivate(account);
      onSignedIn();
    } catch {
      setError("Failed to decrypt. Check your ncryptsec and password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">
          Encrypted key (NIP-49)
        </h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Paste your <span className="font-mono text-xs">ncryptsec</span> and
          the password used to encrypt it.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="text"
          className={`input input-bordered w-full font-mono text-sm${error ? " input-error" : ""}`}
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
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={loading}
        >
          {loading ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            "Unlock & sign in"
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bunker (NIP-46 paste URI)
// ---------------------------------------------------------------------------

function BunkerMethod({ onSignedIn }: { onSignedIn: SignedInHandler }) {
  const [uri, setUri] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const signer = await NostrConnectSigner.fromBunkerURI(uri.trim());
      const pubkey = await signer.getPublicKey();
      const account = new NostrConnectAccount(pubkey, signer);
      addAndActivate(account);
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to bunker.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <BackButton />
        <h1 className="text-2xl font-semibold text-base-content">
          Nostr Connect
        </h1>
        <p className="mt-1 text-base-content/50 text-sm">
          Paste the <span className="font-mono text-xs">bunker://</span> URI
          from your remote signer (e.g. nsecBunker, Citrine).
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="text"
          className={`input input-bordered w-full font-mono text-sm${error ? " input-error" : ""}`}
          placeholder="bunker://…"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={loading}
        >
          {loading ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            "Connect"
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Route page wrappers — each sign-in method has its own route.
// After sign-in, navigate to ?redirect= or /r (the report flow entry point).
// Sign-in pages have no knowledge of the report flow internals.
// ---------------------------------------------------------------------------

function useSignInHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = getSafeRedirect(location.search);
  return () => navigate(redirectTo ?? REPORT_PAGE_BASE);
}

export function SignInPrivateKeyPage() {
  const handleSignedIn = useSignInHandler();
  return <PrivateKeyMethod onSignedIn={handleSignedIn} />;
}

export function SignInPasswordPage() {
  const handleSignedIn = useSignInHandler();
  return <PasswordMethod onSignedIn={handleSignedIn} />;
}

export function SignInBunkerPage() {
  const handleSignedIn = useSignInHandler();
  return <BunkerMethod onSignedIn={handleSignedIn} />;
}
