declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly VITE_USE_MOCK: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

function parseBoolean(value: string): boolean {
  return value.toLowerCase() === 'true'
}

export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  useMock: parseBoolean(import.meta.env.VITE_USE_MOCK),
} as const
