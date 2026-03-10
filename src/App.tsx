import {
  AccountsProvider,
  EventStoreProvider,
  FactoryProvider,
} from "applesauce-react/providers";
import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppProvider, pagePath, useApp } from "./context/AppContext.tsx";
import { manager } from "./lib/accounts.ts";
import { factory } from "./lib/factory.ts";
import { eventStore } from "./lib/store.ts";
import CompleteView from "./pages/complete/index.tsx";
import CompleteReferralView from "./pages/complete/ReferralView.tsx";
import ReferralView from "./pages/ref/index.tsx";
import REPORTS from "./pages/reports.tsx";
import SignInLayout from "./pages/signin/SignInLayout.tsx";
import {
  SignInBunkerPage,
  SignInPasswordPage,
  SignInPrivateKeyPage,
} from "./pages/signin/SignInMethodPage.tsx";
import SignInMethods from "./pages/signin/SignInMethods.tsx";
import StepPubkey from "./pages/signin/StepPubkey.tsx";

// ---------------------------------------------------------------------------
// Route guard: redirect to root if no subject user is set
// ---------------------------------------------------------------------------
function RequireSubject({ children }: { children: React.ReactNode }) {
  const { subject: subjectUser } = useApp();
  if (!subjectUser) {
    // NOTE: disabled because auto redirect is stupid
    // const returnTo =
    //   location.pathname !== "/" && location.pathname !== ""
    //     ? `?redirect=${encodeURIComponent(location.pathname + location.search)}`
    //     : "";

    return <Navigate to={`/`} replace />;
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Fallback shown while a lazy page chunk is loading
// ---------------------------------------------------------------------------
function PageFallback() {
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card shell — shared layout for complete/* pages
// ---------------------------------------------------------------------------
function CompleteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-base-100 rounded-2xl border border-base-200 p-8 shadow-sm flex flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner app — inside the router so useNavigate works
// ---------------------------------------------------------------------------
function AppRoutes() {
  return (
    <AppProvider pages={REPORTS}>
      <Routes>
        {/* Sign-in flow — all share the card layout */}
        <Route element={<SignInLayout />}>
          <Route index element={<StepPubkey />} />
          <Route path="signin" element={<SignInMethods />} />
          <Route path="signin/privatekey" element={<SignInPrivateKeyPage />} />
          <Route path="signin/password" element={<SignInPasswordPage />} />
          <Route path="signin/bunker" element={<SignInBunkerPage />} />
        </Route>

        {/* Diagnostic pages — require a subject pubkey */}
        {REPORTS.map(({ name, Component }) => (
          <Route
            key={name}
            path={pagePath(name)}
            element={
              <RequireSubject>
                <Suspense fallback={<PageFallback />}>
                  <Component />
                </Suspense>
              </RequireSubject>
            }
          />
        ))}

        {/* Complete view — terminal destination after all diagnostic pages */}
        <Route
          path="complete"
          element={
            <RequireSubject>
              <Suspense fallback={<PageFallback />}>
                <CompleteView />
              </Suspense>
            </RequireSubject>
          }
        />

        {/* Referral link creation — cross-user flow, navigated to by CompleteView */}
        <Route
          path="complete/referral"
          element={
            <RequireSubject>
              <CompleteShell>
                <CompleteReferralView />
              </CompleteShell>
            </RequireSubject>
          }
        />

        {/* Referral link — load a Blossom-hosted repair kit */}
        <Route path="ref/:sha256" element={<ReferralView />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}

// ---------------------------------------------------------------------------
// Root — provides applesauce context to the entire tree
// ---------------------------------------------------------------------------
function App() {
  return (
    <EventStoreProvider eventStore={eventStore}>
      <AccountsProvider manager={manager}>
        <FactoryProvider factory={factory}>
          <AppRoutes />
        </FactoryProvider>
      </AccountsProvider>
    </EventStoreProvider>
  );
}

export default App;
