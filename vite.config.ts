import { defineConfig } from 'vite-plus';
import Macros from 'unplugin-macros/vite';
import MacrosRolldown from 'unplugin-macros/rolldown';

export default defineConfig({
  plugins: [Macros()],
  test: {
    globals: true,
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**', '.vite-hooks/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
  },
  pack: {
    entry: ['src/index.ts'],
    clean: true,
    dts: true,
    format: ['esm'],
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    target: 'node20',
    unbundle: true,
    plugins: [MacrosRolldown()],
  },
  run: {
    tasks: {
      ci: {
        command: 'vp check && vp test run && vp pack',
      },
      start: {
        command: 'node dist/index.js',
      },
      'test:integration': {
        command: 'node test/integration-check.mts',
      },
      'test:smoke': {
        command: 'node test/e2e/smoke-test.ts',
      },
    },
  },
  staged: {
    '*.{js,mjs,cjs,ts,mts,cts,jsx}': 'vp check --fix',
  },
});
