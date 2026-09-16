import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      // Exercise the real globe renderer even on test runners without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'python3 -m http.server 3000 --bind 127.0.0.1 -d dist',
    url: 'http://127.0.0.1:3000/frontend/',
    reuseExistingServer: !process.env.CI,
  },
});
