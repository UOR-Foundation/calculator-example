import { defineConfig } from '@playwright/test';

const live = process.env.BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: live ?? 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true
  },
  webServer: live
    ? undefined
    : {
        command: 'npx --no-install http-server public -p 4173 -c-1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false
      }
});
