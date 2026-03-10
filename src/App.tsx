import {
  AccountsProvider,
  EventStoreProvider,
  FactoryProvider,
} from "applesauce-react/providers";
import { use$ } from "applesauce-react/hooks";
import { Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router";
import { ReportProvider } from "./context/ReportContext.tsx";
import { manager } from "./lib/accounts.ts";
import { factory } from "./lib/factory.ts";
import { eventStore } from "./lib/store.ts";
import { subjectPubkey$ } from "./lib/subjectPubkey.ts";
import { REPORT_PAGE_BASE, pagePath } from "./lib/routing.ts";
import ReportErrorBoundary from "./components/ReportErrorBoundary.tsx";
import CompleteView from "./pages/complete/index.tsx";
import CompleteReferralView from "./pages/complete/ReferralView.tsx";
import ReferralView from "./pages/ref/index.tsx";
import ReportsIndex from "./pages/reports/index.tsx";
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
// Route guard: redirect to root if no subject pubkey is set.
// Reads subjectPubkey$ directly — no context dependency, works anywhere
// in the tree regardless of whether ReportProvider is mounted above it.
// ---------------------------------------------------------------------------
function RequireSubject({ children }: { children: React.ReactNode }) {
  const subjectPubkey = use$(subjectPubkey$);
  if (!subjectPubkey) {
    return <Navigate to="/" replace />;
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
// Layout route that mounts ReportProvider around all report + complete pages.
// Uses <Outlet> so React Router renders the matched child route inside it.
// ---------------------------------------------------------------------------
function ReportLayout() {
  return (
    <ReportProvider pages={REPORTS}>
      <Outlet />
    </ReportProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner app — inside the router so useNavigate works
// ---------------------------------------------------------------------------
function AppRoutes() {
  return (
    <Routes>
      {/* Sign-in flow — no ReportProvider needed */}
      <Route element={<SignInLayout />}>
        <Route index element={<StepPubkey />} />
        <Route path="signin" element={<SignInMethods />} />
        <Route path="signin/privatekey" element={<SignInPrivateKeyPage />} />
        <Route path="signin/password" element={<SignInPasswordPage />} />
        <Route path="signin/bunker" element={<SignInBunkerPage />} />
      </Route>

      {/* Referral link consumption — fully self-contained, no ReportProvider */}
      <Route path="ref/:sha256" element={<ReferralView />} />

      {/* Report flow + complete — wrapped in ReportProvider via ReportLayout */}
      <Route element={<ReportLayout />}>
        {/* /r index — redirects to first report */}
        <Route
          path={REPORT_PAGE_BASE}
          element={
            <RequireSubject>
              <ReportsIndex />
            </RequireSubject>
          }
        />

        {/* Diagnostic report pages */}
        {REPORTS.map(({ name, Component }) => (
          <Route
            key={name}
            path={pagePath(name)}
            element={
              <RequireSubject>
                <Suspense fallback={<PageFallback />}>
                  <ReportErrorBoundary reportName={name}>
                    <Component />
                  </ReportErrorBoundary>
                </Suspense>
              </RequireSubject>
            }
          />
        ))}

        {/* Complete view — terminal destination after all reports */}
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

        {/* Referral link creation — cross-user helper flow */}
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
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
