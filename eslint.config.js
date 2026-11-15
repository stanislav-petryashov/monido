import js from '@eslint/js'
import i18next from 'eslint-plugin-i18next'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Code that runs in Node: the server, scripts, tests (jsdom is also a browser) and build configs.
const NODE_FILES = ['src/server/**', 'scripts/**', 'tests/**', '*.config.{js,ts}', 'vite.*.ts']
// typescript-eslint turns off no-undef, and there is a single tsconfig that knows the node types: names that exist only in Node
// (process, Buffer, require…) are forbidden explicitly in browser code
const NODE_ONLY = Object.keys(globals.node).filter(name => !(name in globals.browser))

// User-visible text in components comes from translation keys: JSX text and these attributes may not hold literals.
const TEXT_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt', 'label']
// Literals with no letters (symbols, punctuation, digits: '—', '%', '×', '·', '$') need no translation
const NO_LETTERS = /^[\p{N}\p{P}\p{S}\s]+$/u
// Codes shown as input examples are not text: ISO currency codes ('RUB') and IANA time zones ('Europe/Moscow')
const CURRENCY_CODE = /^[A-Z]{3}$/
const TIME_ZONE = /^[A-Z][A-Za-z]+(?:\/[A-Z][A-Za-z_]+)+$/

export default defineConfig([
  globalIgnores(['dist', 'output', '.remember', 'sample_project', '.superpowers', '.superdesign', 'docs/superpowers/reports', 'data', 'data-dev', 'coverage', '.claude/worktrees', '.playwright-mcp']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-globals': ['error', ...NODE_ONLY.map(name => ({ name, message: 'Node-only global in browser code (src/** outside src/server)' }))],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, properties: false } }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
    },
    languageOptions: {
      parserOptions: { project: './tsconfig.app.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', {
        mode: 'jsx-only',
        'jsx-attributes': { include: TEXT_ATTRIBUTES, exclude: [] },
        words: { exclude: [NO_LETTERS, CURRENCY_CODE, TIME_ZONE] },
        'should-validate-template': true,
      }],
    },
  },
  {
    files: NODE_FILES,
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-restricted-globals': 'off',
    },
  },
])
