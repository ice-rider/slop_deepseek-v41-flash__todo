import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import App from '@/App'
import { ApiError } from '@/lib/api'
import '@/index.css'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean }
  }
}

/** Errors the UI already surfaces inline should not also raise a toast. */
function shouldNotify(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return ![401, 403, 404, 422].includes(error.status)
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (shouldNotify(error)) {
        toast.error(error instanceof ApiError ? error.message : 'Something went wrong while loading data.')
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return
      if (shouldNotify(error)) {
        toast.error(error instanceof ApiError ? error.message : 'That change could not be saved.')
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
      staleTime: 10_000,
      gcTime: 5 * 60_000,
    },
    mutations: { retry: 0 },
  },
})

/** Last-resort boundary: render a recoverable error instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FlowBoard crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-panel border border-line bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-fg">Something broke on this screen</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            The interface hit an unexpected error. Your data is safe on the server — reloading usually fixes it.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg border border-line bg-elevated p-3 text-left text-[11.5px] text-muted">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 h-9 rounded-xl bg-brand px-4 text-[13px] font-medium text-brand-fg"
          >
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
