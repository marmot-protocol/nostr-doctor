import { ReadonlyAccount } from "applesauce-accounts/accounts";
import { castUser, type User } from "applesauce-common/casts";
import type { EventTemplate } from "applesauce-core/helpers";
import { use$, useActiveAccount } from "applesauce-react/hooks";
import type { ISigner } from "applesauce-signers";
import {
  createContext,
  use,
  useCallback,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { factory } from "../lib/factory.ts";
import { DEFAULT_RELAYS, pool } from "../lib/relay.ts";
import { eventStore } from "../lib/store.ts";
import { subjectPubkey$ } from "../lib/subjectPubkey.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageDefinition = {
  name: string;
  /** Lazy-loaded component for code-splitting; render inside <Suspense> */
  Component: LazyExoticComponent<ComponentType>;
};

export const REPORT_PAGE_BASE = "/r";

/** Build the full path for a diagnostic page by name */
// eslint-disable-next-line react-refresh/only-export-components -- shared routing helper, not a component
export function pagePath(name: string): string {
  return `${REPORT_PAGE_BASE}/${name}`;
}

/**
 * Parse redirect from location search. Returns a path only if it's safe:
 * starts with "/" and contains no "//" (avoids protocol-relative or external URLs).
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared routing helper, not a component
export function getSafeRedirect(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("redirect");
  if (raw != null && raw.startsWith("/") && !raw.includes("//")) return raw;
  return null;
}

export type AppContextValue = {
  /** The user currently being diagnosed — from active account when signed in, else from subjectPubkey$ */
  subject: User | null;

  /** Active signer when the user has signed in with a real account; null when not signed in (read-only flow). */
  signer: ISigner | null;

  /** Navigate to the next page in the PAGES array (or to the first report when not on a report page) */
  next: () => void;

  /**
   * Accepts only unsigned EventTemplate objects (no signed events).
   * - When signer is set: signing and publishing are both handled here.
   * - When signer is null: the template is collected into draftEvents for the final step.
   */
  publish: (template: EventTemplate) => Promise<void>;

  /** Unsigned EventTemplate objects collected when signer is null; package in final step */
  events: EventTemplate[];

  /** Number of events successfully signed and published in this session (signed-in mode only) */
  publishedCount: number;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type AppProviderProps = {
  pages: ReadonlyArray<PageDefinition>;
  children: ReactNode;
};

export function AppProvider({ pages, children }: AppProviderProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [draftEvents, setDraftEvents] = useState<EventTemplate[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);

  const activeAccount = useActiveAccount();
  const subjectPubkey = use$(subjectPubkey$);
  const hasRealSigner =
    activeAccount && !(activeAccount instanceof ReadonlyAccount);
  const subjectUser: User | null = hasRealSigner
    ? castUser(activeAccount.pubkey, eventStore)
    : subjectPubkey
      ? castUser(subjectPubkey, eventStore)
      : null;
  const signer: ISigner | null = hasRealSigner ? activeAccount.signer : null;

  const next = useCallback(() => {
    const currentIndex = pages.findIndex(
      (p) => pagePath(p.name) === location.pathname,
    );
    if (currentIndex === -1) {
      navigate(pagePath(pages[0].name));
      return;
    }
    if (currentIndex >= pages.length - 1) {
      // Last diagnostic page — go to the terminal complete view
      navigate("/complete");
      return;
    }
    navigate(pagePath(pages[currentIndex + 1].name));
  }, [pages, location.pathname, navigate]);

  const publishEvent = useCallback(
    async (template: EventTemplate) => {
      if (signer === null) {
        setDraftEvents((prev) => [...prev, template]);
        return;
      }

      const signed = await factory.sign(template);
      const user = subjectUser;
      if (!user) return;
      const outboxes = await user.outboxes$.$first(3000);
      const relays =
        outboxes && outboxes.length > 0 ? outboxes : DEFAULT_RELAYS;
      await pool.publish(relays, signed);
      setPublishedCount((n) => n + 1);
    },
    [signer, subjectUser],
  );

  const value: AppContextValue = {
    subject: subjectUser,
    signer,
    next,
    publish: publishEvent,
    events: draftEvents,
    publishedCount,
  };

  return <AppContext value={value}>{children}</AppContext>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components -- context files intentionally export hook alongside provider
export function useApp(): AppContextValue {
  const ctx = use(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
