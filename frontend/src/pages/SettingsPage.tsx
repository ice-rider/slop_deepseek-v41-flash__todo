import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Info, KeyRound, LogOut, Moon, Palette, Sun, User } from 'lucide-react'
import { Button, Field, Input, SegmentedControl } from '@/components/ui/primitives'
import { ApiError } from '@/lib/api'
import { useUpdateProfile, useLogout } from '@/hooks/mutations'
import { useMeta } from '@/hooks/queries'
import { useAuthStore } from '@/store/auth'
import { useResolvedTheme, useUiStore, type ThemeMode } from '@/store/ui'
import { cn } from '@/lib/utils'

const avatarColors = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#22c55e']

/** Account, appearance and build information. */
export function SettingsPage() {
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const logout = useLogout()
  const updateProfile = useUpdateProfile()
  const meta = useMeta()
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const resolvedTheme = useResolvedTheme()

  const [name, setName] = useState(user?.name ?? '')
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? '#6366f1')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const saveProfile = async () => {
    setErrors({})
    if (!name.trim()) {
      setErrors({ name: 'Name cannot be blank.' })
      return
    }
    try {
      const result = await updateProfile.mutateAsync({ name: name.trim(), avatarColor })
      setUser(result.user)
      toast.success('Profile updated')
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.fields ?? {})
        toast.error(caught.message)
      } else {
        toast.error('Could not update your profile')
      }
    }
  }

  const changePassword = async () => {
    setErrors({})
    if (password.length < 8) {
      setErrors({ password: 'Use at least 8 characters.' })
      return
    }
    if (password !== confirmPassword) {
      setErrors({ confirmPassword: 'The passwords do not match.' })
      return
    }
    try {
      await updateProfile.mutateAsync({ password })
      setPassword('')
      setConfirmPassword('')
      toast.success('Password changed — other sessions were signed out')
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.fields ?? {})
        toast.error(caught.message)
      } else {
        toast.error('Could not change your password')
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-12 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-1 text-[13.5px] text-muted">Your profile, appearance and workspace details.</p>
      </header>

      {/* Profile */}
      <section className="rounded-panel border border-line bg-surface p-4 lg:p-5">
        <header className="flex items-center gap-2">
          <User aria-hidden className="size-4 text-muted" />
          <h2 className="text-[15px] font-semibold text-fg">Profile</h2>
        </header>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Display name" error={errors.name} htmlFor="settings-name">
            <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Email" hint="Used to sign in and to share boards with you." htmlFor="settings-email">
            <Input id="settings-email" value={user?.email ?? ''} readOnly className="opacity-70" />
          </Field>
        </div>

        <div className="mt-4 space-y-2">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Palette aria-hidden className="size-3.5" />
            Avatar colour
          </p>
          <div className="flex flex-wrap gap-2">
            {avatarColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                aria-pressed={avatarColor === color}
                onClick={() => setAvatarColor(color)}
                className={cn(
                  'size-8 rounded-full transition ring-offset-2 ring-offset-surface',
                  avatarColor === color ? 'ring-2 ring-fg' : 'hover:scale-110',
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="primary" loading={updateProfile.isPending} onClick={() => void saveProfile()}>
            Save profile
          </Button>
        </div>
      </section>

      {/* Password */}
      <section className="rounded-panel border border-line bg-surface p-4 lg:p-5">
        <header className="flex items-center gap-2">
          <KeyRound aria-hidden className="size-4 text-muted" />
          <h2 className="text-[15px] font-semibold text-fg">Password</h2>
        </header>
        <p className="mt-1 text-[12.5px] text-muted">
          Changing your password signs out every other session. Passwords are hashed with argon2id.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="New password" error={errors.password} htmlFor="settings-password">
            <Input
              id="settings-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm password" error={errors.confirmPassword} htmlFor="settings-confirm">
            <Input
              id="settings-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            variant="secondary"
            loading={updateProfile.isPending}
            disabled={!password}
            onClick={() => void changePassword()}
          >
            Change password
          </Button>
        </div>
      </section>

      {/* Appearance */}
      <section className="rounded-panel border border-line bg-surface p-4 lg:p-5">
        <header className="flex items-center gap-2">
          {resolvedTheme === 'dark' ? (
            <Moon aria-hidden className="size-4 text-muted" />
          ) : (
            <Sun aria-hidden className="size-4 text-muted" />
          )}
          <h2 className="text-[15px] font-semibold text-fg">Appearance</h2>
        </header>
        <p className="mt-1 text-[12.5px] text-muted">
          Currently showing the {resolvedTheme} palette. Board view, filters and the sidebar are remembered per device.
        </p>

        <div className="mt-4">
          <SegmentedControl<ThemeMode>
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> },
              { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> },
              { value: 'system', label: 'System', icon: <Check className="size-3.5" /> },
            ]}
          />
        </div>
      </section>

      {/* About */}
      <section className="rounded-panel border border-line bg-surface p-4 lg:p-5">
        <header className="flex items-center gap-2">
          <Info aria-hidden className="size-4 text-muted" />
          <h2 className="text-[15px] font-semibold text-fg">About this workspace</h2>
        </header>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'API version', value: meta.data?.version ?? '—' },
            { label: 'Commit', value: meta.data?.commit?.slice(0, 12) ?? '—' },
            { label: 'Environment', value: meta.data?.env ?? '—' },
          ].map((row) => (
            <div key={row.label} className="rounded-xl border border-line bg-elevated/50 px-3 py-2">
              <dt className="text-[11.5px] uppercase tracking-wide text-subtle">{row.label}</dt>
              <dd className="mt-0.5 truncate font-mono text-[12.5px] text-fg">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted">Signed in as {user?.email}</p>
          <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </section>
    </div>
  )
}
