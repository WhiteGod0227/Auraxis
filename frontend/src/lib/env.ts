declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string
    readonly BASE_URL: string
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}
export const env = {
  apiBaseUrl: import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8010',
} as const
