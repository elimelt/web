import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    },
  },
  webServer: [
    {
      command: 'python3 -m http.server 4173 --bind 127.0.0.1 -d dist/frontend',
      url: 'http://127.0.0.1:4173/',
      reuseExistingServer: false,
    },
    {
      command: 'python3 -m http.server 4174 --bind 127.0.0.1 -d dist/infra/homepage',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: false,
    },
  ],
});
