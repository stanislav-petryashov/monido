# Monido: CLAUDE.md

A family net worth dashboard: an SPA (React, ECharts) + a Node server on Hono, SQLite via `node:sqlite`. The server computes the snapshot in its base currency (`/api/snapshot`) with the pure domain layer `src/domain/`, the SPA draws it; data is entered in the month-close wizard and on the records screens (`section: 'data'`).

The code map, the data model, the how-tos "new metric / table / module / translation key / language" and the test layout: `docs/architecture.md`. The database schema: `docs/schema.md`. The design system: `docs/design-system.md`. Deployment: `docs/deploy-docker.md`.

## Commands

```bash
npm run dev                      # server :8080 (database ./data-dev) + Vite :5173
npm run check                    # lint + knip (both modes) + tests + build + size budgets — before every push
npx vitest run                   # tests only
npm run db:seed -- --reset-demo  # demo data in ./data-dev
docker compose up -d             # production, data in the volume `data`
```

## Domain rules (`src/domain`: pure functions, no SQLite/fetch/React)

1. All snapshot amounts are in the snapshot's currency (`baseCurrency`); conversion only via `convert()`; a currency without a rate → `null` + a warning.
2. A balance is the last day of the month, a flow is the first; all dates are UTC (`dates.ts`).
3. Net worth for month M uses the rate of the last day of M; balances from earlier months are not carried over.
4. Monthly metrics use the last closed month with data, not the calendar one.
5. Pages do not sum raw rows: whatever more than one page needs is computed in the domain.
6. The dashboard sees only closed months (`closed_months`); a month is closed whole and in order in the wizard.

## Design system

- Colors are only the tokens of `src/styles/tokens.css`; hex and `rgb()` are allowed only there, in `src/lib/chartColors.ts` and in the static logo SVGs (`public/favicon.svg`, `docs/assets/logo.svg`; `LogoMark` itself uses tokens). `--primary` is the interactive, the selected and the main data series, never decoration; `--error`/`--warning`/`--success` are an assessment, not the sign of an amount; colored text is only `--X-text`.
- Violet means here-and-now: the selected item, one primary button per screen, the current period on a chart, progress fills, focus, links, the logo; never icons, titles, deltas or the past on a chart.
- Two themes, only through tokens; components do not know about the theme. Charts get the theme through `useChartTheme()`.
- Spacing and radii are the scales `--sp-*`, `--r-*`; raw px in `padding`/`margin`/`gap` are forbidden. The font is Onest, sizes `--fs-*`.
- `Card` is the one surface: `--paper` on the ground, no border, no shadow; menus and dialogs float on `--raised` with `--shadow-float`; the main number is one large figure per page, weight 400 (a KPI strip, `.hl__value`); `Chip` is status only.
- Numbers go through `fmtNum` / `fmtPct` / `fmtMonths` / `fmtMoney`, not `toFixed`; figures are weight 400. Icons are Tabler, passed as a prop through `createElement`.
- Menus and dialogs do not write their own mechanics: `usePopover`, `Dialog` + `useModalDialog`. Writing is `apiSend`; server reads are `useQuery`, writes are `useMutation` + invalidate; Records-section keys start with `'admin'`.

## Boundaries

- The core does not know module names. A new core ↔ module link is a new extension point, not an `if`; the permitted exceptions are listed in `docs/architecture.md`. Modules are always on; the only per-module condition is `notInDemo` (absent in the public demo).
- `schema.sql` creates empty databases only. Existing databases are validated, not upgraded. A schema change needs an explicit data-preserving update plan for the two installations and their backups.
- An export used only by tests is a test seam, marked `@public` in JSDoc; otherwise `knip --production` rejects it.

## Language

- Everything in the repository is English; files named `ru-RU.json` under `src/locales/`, the demo data file `src/demo/ru-RU.json`, `README.ru-RU.md` and the README language bar are the only places with Cyrillic (`tests/i18n/noCyrillic.test.ts`). The translated READMEs (`README.<lang>.md`) follow `README.md`.
- User-visible text only through translation keys: `useTranslation()` / `t()`; a JSX literal is a lint error (`i18next/no-literal-string`). Markup inside a sentence: one key and `<Trans>`, not glued fragments.
- A new key goes into `en-US` and `ru-RU`; the other locales catch up on Weblate and fall back to English (`docs/translating.md`, `tests/i18n/locales.test.ts`).
- The domain and the server return keys and params, not text.

## Maintenance

Added, removed or renamed a file, component, hook or export? Update `docs/architecture.md`: the test `tests/docs/architecture.test.ts` checks that every path there exists and every `src/` file is mentioned. Unused CSS classes and tokens are caught by `tests/styles/deadCss.test.ts`. User-facing changes go in `docs/user-guide.md`.

Every change a user or operator would notice gets a line in `CHANGELOG.md` under `[Unreleased]` (Keep a Changelog, SemVer). A release is a `vX.Y.Z` tag cut as in `docs/maintaining.md` "Cutting a later release"; CI publishes the image, the GitHub release and the demo. `master` and `v*` tags are protected: changes land through a PR with a green `check`.
