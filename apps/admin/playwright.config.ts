import { defineConfig } from '@playwright/test';

/**
 * Test de l'application d'administration dans un vrai navigateur (Chromium), contre la vraie API.
 * L'API et la base sont préparées par .github/scripts/run-admin-e2e.sh (comptes de test, aucune donnée réelle).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
