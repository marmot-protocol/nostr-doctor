import {
  createContext,
  use,
  useState,
  useCallback,
  type ReactNode,
  type LazyExoticComponent,
  type ComponentType,
} from "react";
import { useNavigate, useLocation } from "react-router";
import type { EventTemplate } from "applesauce-core/helpers";
import { ReadonlyAccount } from "applesauce-accounts/accounts";
import { useActiveAccount } from "applesauce-react/hooks";
import { castUser, type User } from "applesauce-common/casts";
import { manager } from "../lib/accounts.ts";
import { factory } from "../lib/factory.ts";
import { pool, DEFAULT_RELAYS } from "../lib/relay.ts";
import { eventStore } from "../lib/store.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageDefinition = {
  path: string;
  name: string;
  /** Lazy-loaded component for code-splitting; render inside <Suspense> */
  Component: LazyExoticComponent<ComponentType>;
};

export type AppContextValue = {
  /** The user currently being diagnosed — derived from the active account's pubkey */
  subjectUser: User | null;

  /** Navigate to the next page in the PAGES array */
  next: () => void;

  /**
   * Accepts only unsigned EventTemplate objects (no signed events).
   * - When the user has a real signer: signing and publishing are both handled here.
   * - When the user is in read-only mode (no account or ReadonlyAccount): the template
   *   is NOT signed and MUST be collected into draftEvents so the app can package them
   *   in the final step.
   */
  publishEvent: (template: EventTemplate) => Promise<void>;

  /** Unsigned EventTemplate objects collected when in read-only mode; package in final step */
  draftEvents: EventTemplate[];
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

  // subjectUser is derived from the currently active account — no separate state needed
  const activeAccount = useActiveAccount();
  const subjectUser: User | null = activeAccount
    ? castUser(activeAccount.pubkey, eventStore)
    : null;

  const next = useCallback(() => {
    const currentIndex = pages.findIndex((p) => p.path === location.pathname);
    if (currentIndex === -1 || currentIndex >= pages.length - 1) return;
    navigate(pages[currentIndex + 1].path);
  }, [pages, location.pathname, navigate]);

  const publishEvent = useCallback(async (template: EventTemplate) => {
    const active = manager.active;
    const isReadOnly = !active || active instanceof ReadonlyAccount;

    if (isReadOnly) {
      // MUST collect unsigned templates for packaging in the final step
      setDraftEvents((prev) => [...prev, template]);
      return;
    }

    // Sign at app level, then publish
    const signed = await factory.sign(template);
    const user = castUser(active.pubkey, eventStore);
    const outboxes = await user.outboxes$.$first(3000);
    const relays = outboxes && outboxes.length > 0 ? outboxes : DEFAULT_RELAYS;
    await pool.publish(relays, signed);
  }, []);

  const value: AppContextValue = {
    subjectUser,
    next,
    publishEvent,
    draftEvents,
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
