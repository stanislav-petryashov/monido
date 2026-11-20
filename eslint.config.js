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

// The core may import the module registries (src/modules/client.tsx, server.ts, monthEntries.ts…), not a module's own files,
// except the documented ones (docs/architecture.md, Known exceptions): the Income and expenses page and the wizard use Cash
// flow's parts, Goals its key, the stdio command the advisor's MCP server, the core cards the prompts' copy button
const MODULE_FILES = {
  regex: '^(\\.\\./)+modules/(?!(cashflow/(spendingWrites|AllocationEditor|useAllocations|ManualAmount)|goals/goalKey|advisor/(mcp|tools/registry)|claude-prompts/CopyPromptButton)$)[^/]+/',
  message: "the core does not import a module's files: add an extension point, or document an exception in docs/architecture.md first",
}

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
    files: ['src/**/*.{ts,tsx}', 'design/**/*.{ts,tsx}'],
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
  // Architecture boundaries (CLAUDE.md, docs/architecture.md "Known exceptions"): the domain is pure, the core does not reach
  // into a module's files, browser code does not import the server. A new exception is a decision: document it there first.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-*', 'react/*', '@tanstack/*', 'i18next', 'echarts', 'echarts/*', 'hono', 'hono/*', '@hono/*', 'node:*'], message: 'src/domain is pure: no React, data fetching, i18n runtime, charts, server or Node APIs (CLAUDE.md, domain rules)' },
        { group: ['**/server/**', '**/pages/**', '**/components/**', '**/lib/**'], message: 'src/domain is pure: it does not import the server or the client' },
        // exception 16: the API types use Reminders' types only
        { group: ['**/modules/*/**', '!**/modules/reminders/domain'], message: 'the domain does not know module files (docs/architecture.md, Known exceptions)' },
      ] }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/modules/**', 'src/domain/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [MODULE_FILES] }],
    },
  },
  {
    files: ['src/pages/**', 'src/components/**', 'src/lib/**', 'src/*.tsx', 'src/i18n/**', 'design/**'],
    rules: {
      // one list per file: a later block replaces the rule's options, so the module rule is repeated here
      'no-restricted-imports': ['error', { patterns: [MODULE_FILES, { group: ['**/server/**'], message: 'browser code does not import the server: share through src/domain' }] }],
    },
  },
  {
    files: ['src/server/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['**/pages/**', '**/components/**'], message: 'the server does not import the client' },
        // shared helpers the server words Telegram messages and update checks with
        { group: ['**/lib/**', '!**/lib/milestoneText', '!**/lib/imageRepo'], message: 'the server imports src/lib only for the shared helpers listed here' },
        MODULE_FILES,
      ] }],
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
