// @license
// Copyright (c) 2025 Rljson
//
// Use of this source code is governed by terms that can be
// found in the LICENSE file in the root of this package.

import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    globals: true,
    // main.ts manipulates the DOM directly (no framework) — this needs a
    // real `document`/`window` to run against in Node. happy-dom instead
    // of the more common jsdom deliberately: jsdom's html-encoding-sniffer
    // dependency currently requires the pure-ESM @exodus/bytes package via
    // CJS require(), which throws under Node <22 (this workspace runs Node
    // 20) — not an issue on CI's Node 22, but happy-dom sidesteps it
    // everywhere and has no such interop problem.
    environment: 'happy-dom',
    include: ['**/test/**/*.spec.ts'],

    reporters: ['default'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // Ambient type declaration only — no runtime statements to cover.
      exclude: ['src/vite-env.d.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
