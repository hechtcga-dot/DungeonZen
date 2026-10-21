import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Campaign tests make a database on disk: slow Windows CI runners need more than the 5 s default.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30000 }
})
