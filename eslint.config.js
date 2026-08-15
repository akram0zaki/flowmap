// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

/**
 * Flowmap lint rules.
 *
 * Three groups here are not style preferences — they enforce architectural
 * decisions from the spec, and CI treats them as hard failures:
 *
 *   1. Boundaries  — the dependency graph in docs/spec/12-repository-layout.md §2
 *   2. Purity      — domain / rules / visual-model are pure (no React, no I/O,
 *                    no ambient time, ids, randomness, locale, or console)
 *   3. Tokens      — no raw colours, sizes, or font stacks outside packages/ui/tokens
 */

const PURE_PACKAGES = ['packages/domain/**', 'packages/rules/**', 'packages/visual-model/**'];

/**
 * Ambient sources of non-determinism. Time, ids, and locale are injected, which
 * is what makes every command handler and every rule reproducible.
 */
const RESTRICTED_GLOBALS = [
  {
    name: 'Intl',
    message:
      'Pure packages must not format for a locale. Return structured facts and format in the UI.',
  },
  { name: 'console', message: 'Pure packages must not print. Return diagnostics as data.' },
];

const RESTRICTED_PROPERTIES = [
  {
    object: 'Math',
    property: 'random',
    message: 'Pure packages must not use randomness. Inject an IdGenerator.',
  },
  {
    object: 'crypto',
    property: 'randomUUID',
    message: 'Pure packages must not generate ids. Inject an IdGenerator.',
  },
  {
    object: 'Date',
    property: 'now',
    message:
      'Pure packages must not read ambient time. Inject a Clock — see docs/spec/01-domain-model.md §2.2.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      // Rust build output contains generated JS that is not ours to lint.
      '**/src-tauri/target/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── 1. Package boundaries ────────────────────────────────────────────────
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/**/*', 'apps/**/*', 'fixtures/**/*'],
      'boundaries/elements': [
        { type: 'domain', pattern: 'packages/domain/**' },
        { type: 'rules', pattern: 'packages/rules/**' },
        { type: 'visual-model', pattern: 'packages/visual-model/**' },
        { type: 'storage', pattern: 'packages/storage/**' },
        { type: 'storage-impl', pattern: 'packages/storage-{local,file,sharepoint}/**' },
        { type: 'import-export', pattern: 'packages/import-export/**' },
        { type: 'ui', pattern: 'packages/ui/**' },
        { type: 'testing', pattern: 'packages/testing/**' },
        { type: 'fixtures', pattern: 'fixtures/**' },
        { type: 'app', pattern: 'apps/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} may not import ${dependency.type} (docs/spec/12 §2).',
          rules: [
            { from: 'domain', allow: [] },
            { from: 'ui', allow: [] },
            { from: 'rules', allow: ['domain'] },
            { from: 'visual-model', allow: ['domain'] },
            { from: 'storage', allow: ['domain'] },
            { from: 'storage-impl', allow: ['domain', 'storage'] },
            { from: 'import-export', allow: ['domain'] },
            { from: 'testing', allow: ['domain', 'storage'] },
            { from: 'fixtures', allow: ['domain', 'testing'] },
            {
              from: 'app',
              allow: [
                'domain',
                'rules',
                'visual-model',
                'storage',
                'storage-impl',
                'import-export',
                'ui',
              ],
            },
          ],
        },
      ],
    },
  },

  // ── 2. Purity of the domain packages ─────────────────────────────────────
  {
    files: PURE_PACKAGES,
    rules: {
      'no-restricted-globals': ['error', ...RESTRICTED_GLOBALS],
      'no-restricted-properties': ['error', ...RESTRICTED_PROPERTIES],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'react-dom', '@testing-library/*'],
              message: 'Pure packages must not depend on React.',
            },
            {
              group: ['node:*', 'fs', 'path', 'http', 'https', 'net', 'child_process'],
              message: 'Pure packages must not perform I/O. Return data; let storage persist it.',
            },
            {
              group: ['@tauri-apps/*'],
              message: 'Pure packages must not reach the desktop shell.',
            },
            {
              group: ['@flowmap/storage*', '@flowmap/ui'],
              message: 'Pure packages must not depend on storage or UI (docs/spec/12 §2).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Ambient time. Inject a Clock — see docs/spec/01-domain-model.md §2.2.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Ambient time. Inject a Clock — see docs/spec/01-domain-model.md §2.2.',
        },
      ],
    },
  },

  // ── 3. Design tokens ─────────────────────────────────────────────────────
  // Every colour, size, radius, and font stack has exactly one home.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ignores: ['packages/ui/tokens/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/]',
          message:
            'Raw colour. Use a token from @flowmap/ui/tokens (docs/design/design-system.md).',
        },
        {
          selector: 'Literal[value=/\\b(?:rgb|rgba|hsl|hsla)\\(/]',
          message: 'Raw colour. Use a token from @flowmap/ui/tokens.',
        },
        {
          selector: 'Literal[value=/^-?\\d+(?:\\.\\d+)?(?:px|rem|em)$/]',
          message: 'Raw size. Use a space, text, or radius token from @flowmap/ui/tokens.',
        },
      ],
    },
  },

  // ── Everything else ──────────────────────────────────────────────────────
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // Tests may reach for the things production code may not.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'packages/testing/**'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
