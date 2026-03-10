import { ReadonlyAccount } from "applesauce-accounts/accounts";
import { castUser, type User } from "applesauce-common/casts";
import type { EventTemplate } from "applesauce-core/helpers";
import { use$, useActiveAccount } from "applesauce-react/hooks";
import type { ISigner } from "applesauce-signers";
import {
  createContext,
  use,
  useCallback,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { factory } from "../lib/factory.ts";
import { DEFAULT_RELAYS, pool } from "../lib/relay.ts";
import { eventStore } from "../lib/store.ts";
import { subjectPubkey$ } from "../lib/subjectPubkey.ts";
import { draftEvents$ } from "../lib/draftEvents.ts";
import { pagePath } from "../lib/routing.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageDefinition = {
  name: string;
  /** Lazy-loaded component for code-splitting; render inside <Suspense> */
  Component: LazyExoticComponent<ComponentType>;
};

export type ReportContextValue = {
  /** The user currently being diagnosed */
  subject: User | null;

  /** Active signer when signed in; null in read-only mode */
  signer: ISigner | null;

  /** Navigate to the next page in the report sequence */
  next: () => void;

  /**
   * Accepts only unsigned EventTemplate objects.
   * - Signer present: signs and publishes immediately.
   * - Signer null: queues into draftEvents$ for the final step.
   */
  publish: (template: EventTemplate) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ReportContext = createContext<ReportContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type ReportProviderProps = {
  pages: ReadonlyArray<PageDefinition>;
  children: ReactNode;
};

export function ReportProvider({ pages, children }: ReportProviderProps) {
  const navigate = useNavigate();
  const location = useLocation();

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
    const replace = { replace: true };
    if (currentIndex >= pages.length - 1) {
      navigate("/complete", replace);
      return;
    }
    navigate(pagePath(pages[currentIndex + 1].name), replace);
  }, [pages, location.pathname, navigate]);

  const publish = useCallback(
    async (template: EventTemplate) => {
      if (signer === null) {
        draftEvents$.next([...draftEvents$.getValue(), template]);
        return;
      }

      const signed = await factory.sign(template);
      const user = subjectUser;
      if (!user) return;
      const outboxes = await user.outboxes$.$first(3000);
      const relays =
        outboxes && outboxes.length > 0 ? outboxes : DEFAULT_RELAYS;
      await pool.publish(relays, signed);
    },
    [signer, subjectUser],
  );

  const value: ReportContextValue = {
    subject: subjectUser,
    signer,
    next,
    publish,
  };

  return <ReportContext value={value}>{children}</ReportContext>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components -- context files intentionally export hook alongside provider
export function useReport(): ReportContextValue {
  const ctx = use(ReportContext);
  if (!ctx) throw new Error("useReport must be used within ReportProvider");
  return ctx;
}
