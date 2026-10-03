import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session, User } from '@/lib/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  /** Set when a refresh attempt fails, so the UI can explain the redirect. */
  expired: boolean
  setSession: (session: Session) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  setUser: (user: User) => void
  markExpired: () => void
  signOut: () => void
}

/**
 * Session store.
 *
 * The store deliberately knows nothing about the HTTP layer; `lib/api.ts`
 * imports it (never the other way round) which keeps the dependency graph
 * acyclic: store -> (nothing), api -> store, hooks -> api.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      expired: false,
      setSession: (session) =>
        set({
          user: session.user,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expired: false,
        }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken, expired: false }),
      setUser: (user) => set({ user }),
      markExpired: () => set({ user: null, accessToken: null, refreshToken: null, expired: true }),
      signOut: () => set({ user: null, accessToken: null, refreshToken: null, expired: false }),
    }),
    {
      name: 'flowboard.auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
)

export const selectIsAuthenticated = (state: AuthState): boolean =>
  Boolean(state.accessToken) && Boolean(state.user)
