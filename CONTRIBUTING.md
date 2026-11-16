# Contributing

Thanks for considering a contribution to Monido. You do not need to know the whole codebase or write code to help.

## Where help is welcome

- **Usability and accessibility:** keyboard navigation, small screens, understandable forms and error messages.
- **Financial calculations:** reproducible edge cases, independently calculated examples and clearer explanations of assumptions.
- **Self-hosting:** installation, upgrades, backups and restore on supported environments.
- **Documentation and translations:** confusing instructions, missing context and the wording in any of the seven languages (see [docs/translating.md](docs/translating.md)).
- **Code and tests:** focused bug fixes, useful regression tests and simpler implementations of existing behavior.

For a bug, use the [issue forms](https://github.com/stanislav-petryashov/monido/issues/new/choose). Include the app version, relevant environment, reproduction steps, and expected versus actual behavior. Use fictional examples for financial data. Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

For a larger feature, dependency, redesign or architectural change, open an issue first. Explain the user problem and the smallest change you think would solve it. Link any related issue and check whether someone is already working on it before starting a substantial PR. Small corrections can go straight to a PR.

The current focus is a self-hosted monthly view of household finances: balances, optional cash flow, and transparent calculations without a required bank connection or external account. Keep the core useful without Claude or Telegram. New integrations and changes to financial methodology need discussion before implementation.

If you would like to help maintain an area, mention it in an issue or PR and describe your interests. Reviewing changes, reproducing reports and improving documentation are useful ongoing contributions as well as writing features.

## User outcomes to contribute to

The [worked examples](docs/use-cases/README.md) connect financial questions to reproducible checks. Each case names its limitations and useful follow-up work. Help reproduce a case, improve an explanation, or report an independently calculated counterexample using fictional data.

## Run the project

Install Node.js 24 and the dependencies with `npm ci`. Running the app, the local database and the commands are described in [docs/development.md](docs/development.md); the code map is [docs/architecture.md](docs/architecture.md).

## Prepare a pull request

Before a pull request, run `npm run check` (linter, unused-code check, tests, build, size budgets). When you change the API or the calculations, add a check that reproduces the bug scenario. For schema changes, update `schema.sql` for new databases and document an explicit, backed-up update procedure for existing installations and backups. The server validates existing databases without automatically changing their schema. Test both a clean install and a copy of the existing database.

Keep each PR focused on one problem and fill in the template: what changed, why, and how you tested it. Link the related issue when there is one. Include screenshots for visible UI changes, using fictional data. If you could not run a relevant check, say which one and why. Do not include `.env`, `data/`, `data-dev/`, real statements, databases, backups, personal screenshots or tokens. Use fictional data in tests. Do not run `db:seed` on a database you want to keep.

## Project conventions

All text in the repository is English (Russian only in the `ru-RU.json` files under `src/locales/` and in the demo data `src/demo/ru-RU.json`), and UI strings are keys in `src/locales/*.json`, never literals in components: see "Adding a translation key / a language" in `docs/architecture.md`.

Reflect user-facing changes in `docs/user-guide.md`; changes to the calculation model in `docs/finance-rules.md`.

Keep refactors small and preserve behavior. Remove unused code only after checking its callers and entry points. Prefer direct code over wrappers or abstractions without a current use. Comments should explain constraints and decisions; remove stale comments and descriptions that merely repeat the code. Keep validation and error handling at trust boundaries. Justify performance changes with measurements or a concrete reduction in work.

ESLint uses type information for `src/` to check Promise handling and redundant assertions and unions. React callbacks may return Promises, but handlers must handle failures. Before publishing, scan both the working files and Git history for secrets; ignored local data must stay outside the release.

## Review and collaboration

Explain the reasoning behind a change, especially when it affects financial results or stored data. Review may ask for a smaller scope, a regression example or a different approach; keep the discussion focused on the problem and the evidence. There is no promised review turnaround. Keep context in the issue or PR so others can follow and help.

The project uses the [MIT license](LICENSE). Keep required copyright and license notices when bringing in code or assets from elsewhere.
