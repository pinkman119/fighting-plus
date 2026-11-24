import { defineStore } from 'pinia'
import type { AuthTokens, UserInfo } from '@shared/types'
import { apiError, configureHttp, http } from '@/api/http'

interface TokenBridge {
  get(): Promise<AuthTokens | null>
  set(tokens: AuthTokens): Promise<void>
  clear(): Promise<void>
}

/** Electron 环境走 safeStorage IPC；浏览器开发环境回退 localStorage */
const tokenStorage: TokenBridge = {
  get: async () => {
    const bridge = (window as unknown as { electronAPI?: { tokens: TokenBridge } }).electronAPI
    if (bridge) return bridge.tokens.get()
    const raw = localStorage.getItem('fp:tokens')
    return raw ? (JSON.parse(raw) as AuthTokens) : null
  },
  set: async (tokens) => {
    const bridge = (window as unknown as { electronAPI?: { tokens: TokenBridge } }).electronAPI
    if (bridge) {
      await bridge.tokens.set(tokens)
      return
    }
    localStorage.setItem('fp:tokens', JSON.stringify(tokens))
  },
  clear: async () => {
    const bridge = (window as unknown as { electronAPI?: { tokens: TokenBridge } }).electronAPI
    if (bridge) {
      await bridge.tokens.clear()
      return
    }
    localStorage.removeItem('fp:tokens')
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UserInfo | null,
    accessToken: null as string | null,
    refreshToken: null as string | null,
    initialized: false
  }),

  getters: {
    isAuthenticated: (s) => s.accessToken !== null
  },

  actions: {
    wireHttp(): void {
      configureHttp({
        getAccessToken: () => this.accessToken,
        getRefreshToken: () => this.refreshToken,
        onTokensRefreshed: (t) => this.setTokens(t),
        onUnauthorized: () => {
          void this.logoutLocal()
        }
      })
    },

    async ensureInitialized(): Promise<void> {
      if (this.initialized) return
      this.wireHttp()
      const tokens = await tokenStorage.get()
      if (tokens?.accessToken) {
        this.setTokens(tokens)
        try {
          const { data } = await http.get<UserInfo>('/users/me')
          this.user = data
        } catch {
          await this.logoutLocal()
        }
      }
      this.initialized = true
    },

    setTokens(tokens: AuthTokens): void {
      this.accessToken = tokens.accessToken
      this.refreshToken = tokens.refreshToken
    },

    async persistTokens(): Promise<void> {
      if (this.accessToken && this.refreshToken) {
        await tokenStorage.set({ accessToken: this.accessToken, refreshToken: this.refreshToken })
      }
    },

    async register(email: string, password: string, nickname: string): Promise<void> {
      const { data } = await http.post('/auth/register', { email, password, nickname })
      this.user = data.user
      this.setTokens(data)
      await this.persistTokens()
    },

    async login(email: string, password: string): Promise<void> {
      const { data } = await http.post('/auth/login', { email, password })
      this.user = data.user
      this.setTokens(data)
      await this.persistTokens()
    },

    async logoutLocal(): Promise<void> {
      this.user = null
      this.accessToken = null
      this.refreshToken = null
      await tokenStorage.clear()
    },

    async logout(): Promise<void> {
      if (this.refreshToken) {
        try {
          await http.post('/auth/logout', { refreshToken: this.refreshToken })
        } catch {
          // ignore
        }
      }
      await this.logoutLocal()
    },

    async updateProfile(patch: { nickname?: string; avatar?: string }): Promise<void> {
      const { data } = await http.patch<UserInfo>('/users/me', patch)
      this.user = data
    },

    async refreshProfile(): Promise<void> {
      const { data } = await http.get<UserInfo>('/users/me')
      this.user = data
    }
  }
})

export { apiError }
