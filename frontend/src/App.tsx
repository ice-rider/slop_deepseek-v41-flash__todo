import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { AuthPage } from '@/pages/AuthPage'
import { Skeleton } from '@/components/ui/primitives'
import { setSessionLostHandler } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { useResolvedTheme } from '@/store/ui'

// The board, dashboard and list views are the heavy screens; load them on
// demand so the sign-in screen stays tiny.
const BoardPage = lazy(() => import('@/pages/BoardPage').then((module) => ({ default: module.BoardPage })))
const BoardsPage = lazy(() => import('@/pages/BoardsPage').then((module) => ({ default: module.BoardsPage })))
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)
const MyWorkPage = lazy(() => import('@/pages/MyWorkPage').then((module) => ({ default: module.MyWorkPage })))
const SearchPage = lazy(() => import('@/pages/SearchPage').then((module) => ({ default: module.SearchPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
)

/** Route-level loading placeholder that keeps the layout from jumping. */
function RouteFallback() {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 rounded-panel" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-panel" />
    </div>
  )
}

/** Gate the app shell behind a session, remembering where the user was headed. */
function RequireAuth() {
  const location = useLocation()
  const isAuthenticated = Boolean(useAuthStore((state) => state.accessToken))

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  return <AppShell />
}

/** Redirect an expired session to the sign-in screen. */
function SessionWatcher() {
  const navigate = useNavigate()
  useEffect(() => {
    setSessionLostHandler(() => navigate('/login', { replace: true }))
    return () => setSessionLostHandler(null)
  }, [navigate])
  return null
}

export default function App() {
  const theme = useResolvedTheme()

  return (
    <>
      <SessionWatcher />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/boards" element={<BoardsPage />} />
            <Route path="/boards/:boardId" element={<BoardPage />} />
            <Route path="/my-work" element={<MyWorkPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster
        position="bottom-right"
        theme={theme}
        closeButton
        toastOptions={{
          classNames: {
            toast: 'rounded-xl border border-line bg-surface text-fg shadow-lift text-[13px] items-start gap-2.5',
            description: 'text-muted',
            actionButton: 'bg-brand text-brand-fg rounded-lg',
            cancelButton: 'bg-elevated text-muted rounded-lg',
            closeButton: 'bg-surface border-line text-muted',
          },
        }}
      />
    </>
  )
}
