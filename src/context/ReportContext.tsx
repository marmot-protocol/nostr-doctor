import type { IAccount } from "applesauce-accounts";
import { castUser, type User } from "applesauce-common/casts";
import { relaySet, type EventTemplate } from "applesauce-core/helpers";
import { use$, useActiveAccount } from "applesauce-react/hooks";
import {
  createContext,
  use,
  useCallback,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { draftEvents$ } from "../lib/draftEvents.ts";
import { factory } from "../lib/factory.ts";
import { DEFAULT_RELAYS, pool } from "../lib/relay.ts";
import { pagePath } from "../lib/routing.ts";
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

export type ReportContextValue = {
  /** The user currently being diagnosed */
  subject: User | null;

  /** Active account when signed in; null in read-only mode */
  account: IAccount | null;

  /** Navigate to the next page in the report sequence */
  next: () => void;

  /**
   * Accepts only unsigned EventTemplate objects.
   * - Account present: signs and publishes immediately.
   * - Account null: queues into draftEvents$ for the final step.
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
  // Subject is always the pubkey being diagnosed — never the signer's pubkey.
  // The account is the signed-in identity used only for signing events.
  const subjectUser: User | null = subjectPubkey
    ? castUser(subjectPubkey, eventStore)
    : null;
  const account: IAccount | null = activeAccount ?? null;

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

  const outboxes = use$(() => subjectUser?.outboxes$, [subjectUser]);
  const publish = useCallback(
    async (template: EventTemplate) => {
      if (account === null) {
        draftEvents$.next([...draftEvents$.getValue(), template]);
        return;
      }

      const signed = await factory.sign(template);
      await pool.publish(relaySet(outboxes, DEFAULT_RELAYS), signed);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, outboxes?.join(",")],
  );

  const value: ReportContextValue = {
    subject: subjectUser,
    account,
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
