# Development

## Local development

You need Node.js **24.x** and npm. The first run needs internet access: the dependencies are installed and the server loads exchange rates from api.frankfurter.dev (`FX_API_URL`).

```bash
npm ci
cp .env.example .env        # optional: every line is commented out
npm run dev
```

`npm run dev` starts the server on `http://localhost:8080` (database `./data-dev/finance.sqlite`, empty databases are initialized from `schema.sql`; existing databases are validated at startup) and Vite on `http://localhost:5173` with a `/api` proxy. Open the Vite address. A fresh dev server opens a 15-minute window to set the family password. Password and Telegram sign-in are managed in the web UI. For local testing, `AUTH_MODE=none` in `.env` temporarily disables sign-in while preserving saved settings; remove it and restart to restore them. `.env` cannot supply the family password. `npm run reset-password` clears it on the development database and prints "restart the server", since there is no container to signal. Data is entered month by month in Records → Close month.

The development database (`./data-dev`) is separate from the Docker database (the named volume `data`, mounted at `/data`), so demo data and experiments do not touch real data. `DATA_DIR` in the environment selects another folder: `DATA_DIR=data npm run dev`; a `DATA_DIR` line in `.env` has no effect on `npm run dev` (the script loads the committed `dev.env`, which pins `DATA_DIR=data-dev`, after `.env`). There is no shell syntax in the scripts, so they work on Windows too.

To replace the development data with demo data: `npm run db:seed -- --reset-demo` (the American family in dollars and euros; `--family ru-RU` writes the Russian family in rubles and sets the family language and currency to match; deletes everything in `./data-dev/finance.sqlite`; the server must have been started at least once to create the database; the script validates the current schema before writing; incompatible databases must be updated explicitly). The script never touches the Docker database, which lives in the named volume `data` (mounted at `/data`), not in `./data`. To fill a running Docker install with demo data, use Settings → Data → Danger zone → "Load test data".

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Server (`node --import tsx --watch`, port 8080) and Vite (port 5173) |
| `npm run dev:server` | Server only, restarted on changes |
| `npm run dev:telegram` | The app in Telegram mode without a real bot (below) |
| `npm start` | Run the built server (`dist/server/main.js`, database `./data`) |
| `npm test` | Run the tests once |
| `npm test` | The whole suite once, with V8 coverage of `src/`: a summary in the terminal, `coverage/coverage-summary.json` per file; it fails below the floors in `vitest.config.ts` (`coverage.thresholds`, a ratchet: raise a floor when the measure has moved up for good). For one file use `npx vitest run <file>`, which measures nothing |
| `npm run test:watch` | Tests on file changes |
| `npm run lint` | ESLint check |
| `npm run typecheck` | TypeScript check of `src/`, the configs and `tests/` (`tsc -b`) |
| `npm run build` | Build the client and the server into `dist/` |
| `npm run deadcode` | Unused-code check (knip, in both the default and the production mode) |
| `npm run size` | Gzip size budgets of the built client per scenario (`scripts/size.mjs` over the scenarios and caps of `.size-limit.mjs`, exit 1 over a cap); run after `npm run build` |
| `npm run check` | Linter, unused code, tests, build and size budgets: run it before every push |
| `npm run db:seed -- --reset-demo` | Replace the development database (`./data-dev`) with demo data; `-- --family ru-RU` for the Russian family in rubles (default: the American one) |
| `npm run screenshots` | Regenerate the README screenshot, the README gallery and the social preview (below) |

## Stricter TypeScript, folder by folder

`tsconfig.strict.json` checks the folders in its `include` with `noUncheckedIndexedAccess` (an array or record index may be `undefined`). `tsconfig.json` references it, so `npm run typecheck`, `npm run build` and `npm run check` run it. The `include` list is a ratchet: a folder enters once it is clean and never leaves, and `tests/config/strictRatchet.test.ts` fails if one is removed.

To add a folder:

1. Put it in `include` and run `npx tsc -p tsconfig.strict.json`. The check covers every file the folder imports, so a folder whose imports reach an unclean one waits for that one.
2. Handle each real `undefined`: a guard, an early return, `.at(-1)` with a check, or the default the code already uses. A `!` is for an index an invariant makes certain, with a one-line comment naming the invariant.
3. Add the folder to `RATCHET` in `tests/config/strictRatchet.test.ts`.

The manual QA cases that every change of the advisor's guide, tools or calculations must pass are in [advisor-reference-questions.md](advisor-reference-questions.md).

## The Telegram stand

`npm run dev:telegram` runs the app in Telegram mode on a throwaway database, so the Telegram screens and the bot's messages can be seen without a real bot. Open `http://localhost:8081` and sign in as Ryan (manages), Annika (enters data and votes) or Mila (only votes).

- The database is `./data-telegram`, deleted and rebuilt at every start: the demo family, three voters with linked Telegram and one proposal in each state (open, partly voted, sent back, second version, accepted, withdrawn, expired), made through the council's own store.
- `.env` is not read, so the real bot token stays out, and calls to `api.telegram.org` never leave the machine.
- Stop `npm run dev` first: the stand takes the same ports (8080 and 5173), plus 8081. It also shares the session cookie of `localhost`, so you sign in again when you go back.

The bot's messages are printed in the terminal, and nobody can answer them: vote on the site. The **Sign in with Telegram** button opens the real Telegram in a new tab, with a code that means nothing there, so sign in through the control page instead. The bot's conversations (its buttons, comments and sign-in) are covered by the tests in `tests/modules/advisor/` and `tests/server/`; how they look in Telegram itself takes a real bot.

## Screenshots and the social preview

The README images of every language, `docs/assets/screens/<lang>/` (`hero`, `close`, `goals`, `cashflow`, `assets`, `health` and `phone`, WebP at 2160×1350), and `docs/assets/social-preview.png` (1280×640, English) are generated, not drawn by hand. The gallery's Advisor shot is `docs/use-cases/assets/UC-07-voter.png`, made by the use-case runner:

```bash
npm run screenshots
```

The script builds the app first (a reused `dist/` could shoot old code). Then, for each language, it:
- starts the built server on a free port with a throwaway database in a temporary directory;
- fills that database from the language's fictional family of `src/demo/family.ts` (the only data source), with its embedded exchange rates;
- captures the family's screens with Chrome.

How the screens are staged:
- **The data date.** The browser clock is set to the 25th of the open month, so the data reads as a month old rather than stale.
- **Close month** is shot with four accounts filled from last month's figures.
- **Goals** is shot with the independence goal selected.

Each image is a headline and a subtitle from the family's `screenshots` captions in `src/demo/<lang>.json`, placed over a crop of the real screen. The hero instead shows the family's accounts, properties and loans from `/api/snapshot` running into the net worth card; the same image is copied to `public/demo/hero-<lang>.webp` for the demo's sign-in page. A local HTML page lays out each image. The server and the temporary directory are removed at the end, also on failure.

It needs Google Chrome. `PW_CHANNEL` selects another Playwright browser channel (`chrome-beta`, `msedge`), and `LANGS=en-US,ru-RU` limits the languages. Commit the regenerated images; the script keeps each WebP under 400 KB and `social-preview.png` under 1 MB. Captions are edited in the language files like any demo string, and a new language needs its captions there too.

The HTML templates live inside `scripts/screenshots.ts` and take every colour from the token block of `src/styles/tokens.css`, which is read at run time; the logo geometry is the one of `docs/assets/logo.svg`. The pitch on the social preview is the `PITCH` constant there: it is the README pitch and the GitHub description in [maintaining.md](maintaining.md#description-and-topics), and `tests/docs/readme.test.ts` keeps the three equal.
