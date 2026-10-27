import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // A running preview may have tabs still using the preceding build's chunks.
  // Keep those assets across local rebuilds instead of breaking lazy imports.
  build: { emptyOutDir: false },
  // Local preview must re-fetch the current build after login/UI fixes.
  preview: { headers: { 'Cache-Control': 'no-store' } },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
