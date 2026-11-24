import axios, { AxiosError } from 'axios'

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1',
  timeout: 15000
})

/** 由 auth store 注入，避免循环依赖 */
let getAccessToken: () => string | null = () => null
let getRefreshToken: () => string | null = () => null
let onTokensRefreshed: (t: { accessToken: string; refreshToken: string }) => void = () => {}
let onUnauthorized: () => void = () => {}

export function configureHttp(opts: {
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  onTokensRefreshed: (t: { accessToken: string; refreshToken: string }) => void
  onUnauthorized: () => void
}): void {
  getAccessToken = opts.getAccessToken
  getRefreshToken = opts.getRefreshToken
  onTokensRefreshed = opts.onTokensRefreshed
  onUnauthorized = opts.onUnauthorized
}

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 401 时静默刷新一次并重放请求 */
let refreshing: Promise<string | null> | null = null

async function tryRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null
  if (!refreshing) {
    refreshing = axios
      .post(
        `${http.defaults.baseURL}/auth/refresh`,
        { refreshToken },
        { timeout: 10000 }
      )
      .then((res) => {
        onTokensRefreshed(res.data)
        return res.data.accessToken as string
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined
    if (error.response?.status === 401 && original && !original._retried && original.url?.includes('/auth/') === false) {
      original._retried = true
      const newToken = await tryRefresh()
      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` }
        return http.request(original)
      }
      onUnauthorized()
    }
    if (error.response?.status === 401 && original?.url?.includes('/auth/refresh')) {
      onUnauthorized()
    }
    return Promise.reject(error)
  }
)

export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: string | string[] } | undefined
    const msg = data?.message
    if (typeof msg === 'string') return msg
    if (Array.isArray(msg)) return msg.join('；')
    return e.message
  }
  return (e as Error).message
}
