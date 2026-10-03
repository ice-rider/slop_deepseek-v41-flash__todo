import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Columns3, Keyboard, Sparkles, Zap } from 'lucide-react'
import { Button, Field, Input } from '@/components/ui/primitives'
import { ApiError } from '@/lib/api'
import { useLogin, useRegister } from '@/hooks/mutations'
import { useAuthStore } from '@/store/auth'

const highlights = [
  { icon: Columns3, title: 'Kanban that keeps up', body: 'Drag cards across columns with keyboard or mouse, WIP limits included.' },
  { icon: Zap, title: 'Live for everyone', body: 'Changes stream to every open board over Server-Sent Events.' },
  { icon: Keyboard, title: 'Keyboard first', body: '⌘K for anything, / to search, n for a new card.' },
]

/**
 * Sign-in and sign-up.
 *
 * The demo account is offered as a one-click button because the seeded board is
 * the fastest way to see what the product does.
 */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthenticated = Boolean(useAuthStore((state) => state.accessToken))
  const login = useLogin()
  const register = useRegister()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  if (isAuthenticated) return <Navigate to={redirectTo} replace />

  const pending = login.isPending || register.isPending

  const handleError = (caught: unknown) => {
    if (caught instanceof ApiError) {
      setError(caught.message)
      setFieldErrors(caught.fields ?? {})
      return
    }
    setError('Something went wrong. Please try again.')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setFieldErrors({})
    try {
      if (mode === 'login') {
        await login.mutateAsync({ email: email.trim(), password })
      } else {
        await register.mutateAsync({ email: email.trim(), name: name.trim(), password })
      }
      navigate(redirectTo, { replace: true })
    } catch (caught) {
      handleError(caught)
    }
  }

  const useDemoAccount = async () => {
    setError(null)
    setFieldErrors({})
    setEmail('demo@flowboard.app')
    setPassword('demo1234')
    try {
      await login.mutateAsync({ email: 'demo@flowboard.app', password: 'demo1234' })
      navigate('/dashboard', { replace: true })
    } catch (caught) {
      handleError(caught)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Marketing panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface px-10 py-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 size-[28rem] rounded-full bg-brand/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 right-0 size-[24rem] rounded-full bg-emerald-500/10 blur-3xl"
        />

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-[15px] font-bold text-brand-fg">
              F
            </span>
            <span className="text-[17px] font-semibold tracking-tight text-fg">FlowBoard</span>
          </div>

          <h1 className="mt-14 max-w-md text-4xl font-semibold leading-[1.15] tracking-tight text-fg">
            Plan the work.
            <br />
            Watch it move.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            A kanban board with the small things right: inline card capture, due dates that shout when they matter,
            subtasks that count themselves, and a realtime stream so nobody works from a stale board.
          </p>

          <ul className="mt-10 space-y-5">
            {highlights.map((item) => (
              <li key={item.title} className="flex gap-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-brand">
                  <item.icon aria-hidden className="size-4" />
                </span>
                <span>
                  <span className="block text-[14px] font-medium text-fg">{item.title}</span>
                  <span className="mt-0.5 block max-w-sm text-[13px] leading-relaxed text-muted">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-[12.5px] text-subtle">
          <CheckCircle2 aria-hidden className="size-4 text-emerald-500" />
          Go backend · SQLite · React 19 · nginx · Docker
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-[15px] font-bold text-brand-fg">
              F
            </span>
          </div>

          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-fg lg:mt-0">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-[13.5px] text-muted">
            {mode === 'login'
              ? 'Sign in to pick up where your board left off.'
              : 'Boards, cards and collaborators — no credit card, no setup wizard.'}
          </p>

          <form className="mt-7 space-y-4" onSubmit={submit} noValidate>
            {mode === 'register' ? (
              <Field label="Your name" error={fieldErrors.name} htmlFor="name">
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ada Lovelace"
                />
              </Field>
            ) : null}

            <Field label="Email" error={fieldErrors.email} htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </Field>

            <Field
              label="Password"
              error={fieldErrors.password}
              hint={mode === 'register' ? 'At least 8 characters.' : undefined}
              htmlFor="password"
            >
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {error ? (
              <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-300">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              loading={pending}
              icon={<ArrowRight className="size-4" />}
            >
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11.5px] uppercase tracking-wide text-subtle">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => void useDemoAccount()}
            loading={login.isPending}
            icon={<Sparkles className="size-4" />}
          >
            Explore the demo board
          </Button>
          <p className="mt-2 text-center text-[12px] text-subtle">
            Signs in as demo@flowboard.app with a seeded product-launch board.
          </p>

          <p className="mt-8 text-center text-[13px] text-muted">
            {mode === 'login' ? (
              <>
                New here?{' '}
                <Link to="/register" className="font-medium text-brand hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-brand hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </section>
    </div>
  )
}
