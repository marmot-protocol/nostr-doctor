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
  /** The user currently being diagnosed (from castUser; may differ from signed-in user) */
  subjectUser: User | null;
  /** Set the subject by pubkey; subjectUser is derived via castUser */
  setSubject: (pubkey: string) => void;

  /** Navigate to the next page in the PAGES array */
  next: () => void;

  /**
   * Accepts only unsigned EventTemplate objects. Signing is handled at this level when
   * the user has a real signer; publishing is handled here. If the user is in read-only
   * mode (no account or ReadonlyAccount), the template is not signed and MUST be
   * collected into draftEvents so it can be packaged in the final step.
   */
  publishEvent: (template: EventTemplate) => Promise<void>;

  /** Unsigned EventTemplate objects collected in read-only mode for the final step */
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

  const [subjectPubkey, setSubjectPubkey] = useState("");
  const [draftEvents, setDraftEvents] = useState<EventTemplate[]>([]);

  const subjectUser = subjectPubkey ? castUser(subjectPubkey, eventStore) : null;
  const setSubject = useCallback((pubkey: string) => setSubjectPubkey(pubkey), []);

  const next = useCallback(() => {
    const currentIndex = pages.findIndex((p) => p.path === location.pathname);
    if (currentIndex === -1 || currentIndex >= pages.length - 1) return;
    navigate(pages[currentIndex + 1].path);
  }, [pages, location.pathname, navigate]);

  const publishEvent = useCallback(async (template: EventTemplate) => {
    const active = manager.active;
    const isReadOnly = !active || active instanceof ReadonlyAccount;

    if (isReadOnly) {
      setDraftEvents((prev) => [...prev, template]);
      return;
    }

    const signed = await factory.sign(template);
    const user = castUser(active.pubkey, eventStore);
    const outboxes = await user.outboxes$.$first(3000);
    const relays = outboxes && outboxes.length > 0 ? outboxes : DEFAULT_RELAYS;
    await pool.publish(relays, signed);
  }, []);

  const value: AppContextValue = {
    subjectUser,
    setSubject,
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
