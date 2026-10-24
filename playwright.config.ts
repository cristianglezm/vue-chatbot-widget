import { defineConfig, devices } from '@playwright/test';

/**
 * e2e tests of the demo with scripted workers (`?fakeWorkers`, see src/e2e/fakeWorkers.ts): the real UI and stores,
 * no model download, deterministic. Locally they run against the dev server, in CI against the built demo
 * (`npm run build` first, see .devops/build.sh).
 * See https://playwright.dev/docs/test-configuration.
 */
const isCI = !!process.env.CI;
// a Chromium that is not the one Playwright downloads (sandboxes, distros): PW_CHROMIUM_PATH=/path/to/chromium
const customChromium = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: isCI ? 4 : undefined,
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : 'html',
  use: {
    baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
    launchOptions: customChromium
      ? { executablePath: customChromium, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }
      : {},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retry-with-video',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: isCI
    ? {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: false,
      }
    : {
        command: 'npm run dev -- --port 5173 --strictPort',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
      },
});
