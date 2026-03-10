import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import {
  AccountsProvider,
  EventStoreProvider,
  FactoryProvider,
} from 'applesauce-react/providers'
import { AppProvider, useApp } from './context/AppContext.tsx'
import { eventStore } from './lib/store.ts'
import { manager } from './lib/accounts.ts'
import { factory } from './lib/factory.ts'
import PAGES from './pages/pages.tsx'
import SignInLayout from './pages/SignIn/SignInLayout.tsx'
import StepPubkey from './pages/SignIn/StepPubkey.tsx'
import SignInMethods from './pages/SignIn/SignInMethods.tsx'
import SignInMethodPage from './pages/SignIn/SignInMethodPage.tsx'

// ---------------------------------------------------------------------------
// Route guard: redirect to sign-in if no subject user is set
// ---------------------------------------------------------------------------
function RequireSubject({ children }: { children: React.ReactNode }) {
  const { subjectUser } = useApp()
  if (!subjectUser) return <Navigate to="/" replace />
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Fallback shown while a lazy page chunk is loading
// ---------------------------------------------------------------------------
function PageFallback() {
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner app — inside the router so useNavigate works
// ---------------------------------------------------------------------------
function AppRoutes() {
  return (
    <AppProvider pages={PAGES}>
      <Routes>
        {/* Sign-in flow — all share the card layout */}
        <Route element={<SignInLayout />}>
          <Route index element={<StepPubkey />} />
          <Route path="signin" element={<SignInMethods />} />
          <Route path="signin/:method" element={<SignInMethodPage />} />
        </Route>

        {/* Diagnostic pages — require a subject pubkey */}
        {PAGES.map(({ path, Component }) => (
          <Route
            key={path}
            path={path}
            element={
              <RequireSubject>
                <Suspense fallback={<PageFallback />}>
                  <Component />
                </Suspense>
              </RequireSubject>
            }
          />
        ))}

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  )
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
  )
}

export default App
