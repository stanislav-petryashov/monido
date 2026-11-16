<p align="center"><a href="README.md">English</a> · <a href="README.ru-RU.md">Русский</a> · <a href="README.de-DE.md">Deutsch</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr-FR.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <img src="docs/assets/logo.svg" width="64" height="64" alt="Monido logo">
</p>

<h1 align="center">Monido</h1>

<p align="center">
  Track your net worth and cash flow, on your own or as a family. Self-hosted, entered by hand, no bank connections.
</p>

<p align="center">
  <a href="https://github.com/stanislav-petryashov/monido/releases/latest"><img src="https://img.shields.io/github/v/release/stanislav-petryashov/monido" alt="Latest release"></a>
  <a href="https://github.com/stanislav-petryashov/monido/actions/workflows/docker.yml"><img src="https://img.shields.io/github/actions/workflow/status/stanislav-petryashov/monido/docker.yml?branch=master&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/stanislav-petryashov/monido" alt="License: MIT"></a>
  <a href="https://github.com/stanislav-petryashov/monido/commits/master"><img src="https://img.shields.io/github/last-commit/stanislav-petryashov/monido" alt="Last commit"></a>
  <a href="https://github.com/stanislav-petryashov/monido/pkgs/container/monido"><img src="https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white" alt="Docker image"></a>
  <a href="https://demo.monido.dev"><img src="https://img.shields.io/badge/demo-live-5B4BE0" alt="Live demo"></a>
  <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido"><img src="https://img.shields.io/badge/MCP-registry-black" alt="MCP Registry"></a>
</p>

<p align="center">
  <a href="https://monido.dev">Website</a> · <a href="https://demo.monido.dev">Live demo</a> · <a href="#quick-start">Quick start</a> · <a href="#documentation">Docs</a> · <a href="#contributing">Help build Monido</a> · <a href="https://github.com/stanislav-petryashov/monido/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" width="100%" alt="The Overview page in the light and the dark theme">
</p>

## Why Monido?

For people who want to understand their money month by month, on their own or together with a family.

- **Keep control of your data.** Run it on your own server, keep the database and backups, and choose which optional integrations to enable.
- **See the whole family's finances.** Bring accounts, investments, property and loans into one view, with amounts grouped by owner and currency.
- **Understand progress without connecting a bank.** Enter monthly balances and, optionally, income and expenses to see how your net worth and goals change. Daily transaction entry is not required.

## Features

- **Net worth and cash flow:** monthly history, asset allocation, income and expense categories, and savings rates. Track balances alone or include cash flow.
- **Monthly updates:** an autosaving Close month wizard; only closed months enter the dashboard's calculations.
- **Loans and property:** property valuations, loan schedules and early-payment comparisons.
- **Goals and financial independence:** progress, forecasts, alternative scenarios and explanations of the calculations.
- **Financial health:** indicators, their thresholds and the numbers behind them; incomplete data stays visible.
- **Optional Claude and Telegram integrations:** statement-assisted entry, financial questions, family proposals and reminders. The Advisor requires HTTPS and either the family password or Telegram sign-in; these services are not needed for the core dashboard.
- **Built for self-hosting:** one Docker container and SQLite database, backups and restore, change history with supported undo operations, multiple currencies, light and dark themes.

## Worked examples

Explore [seven household finance use cases](docs/use-cases/README.md): wealth across currencies, net worth after debts, monthly savings, emergency reserves, savings goals, family decisions with the Advisor, and closing a month from bank statements through Claude. Each example includes fictional data, verification results and limits.

## Quick start

Want to look first? [Try the demo](https://demo.monido.dev): a fictional family, a private copy for 15 minutes, nothing to install. The sign-in screen shows the demo password. Changes affect only your temporary copy.

The demo does not include the Claude Advisor or Telegram reminders, and database downloads are disabled. Those features are available in your own installation. Please use fictional data in the demo.

You need Docker with Docker Compose v2.24 or newer (Linux, or Docker Desktop on macOS). In a new folder:

```bash
mkdir family-finance && cd family-finance
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

Open http://127.0.0.1:8080 within 15 minutes and set the family password. Manage Password or Telegram sign-in in the web UI; server settings (port, address) go in an optional `.env` ([`.env.example`](.env.example), [the full guide](docs/deploy-docker.md#installation)). To update: `docker compose pull && docker compose up -d`. Something not working? [Troubleshooting](docs/deploy-docker.md#troubleshooting).

The data is kept in a Docker volume named after the folder (`family-finance_data`); `docker compose down -v` would delete it, so never add `-v`.

## Where to get it

- **Docker Compose** on any Linux server or Docker Desktop: see [Quick start](#quick-start). The image is `ghcr.io/stanislav-petryashov/monido` (amd64 and arm64).
- **Unraid:** search for Monido in Community Applications. It runs as the data folder's owner (`PUID` 99, `PGID` 100 by default).
- **PikaPods** (managed hosting): not yet available. [Vote for Monido](https://feedback.pikapods.com/posts/1289/monido-self-hosted-family-net-worth-and-cash-flow-tracker) to have it added.
- **Claude connector (MCP):** listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.stanislav-petryashov/monido) and on [Glama](https://glama.ai/mcp/servers/stanislav-petryashov/monido).

## Languages

The interface is in English, Russian, German, Spanish, French, Brazilian Portuguese and Simplified Chinese. The German, Spanish, French, Portuguese and Chinese texts are machine translations waiting for native speakers to review them. Corrections are welcome: see [Translating](docs/translating.md).

[![Translation status](https://hosted.weblate.org/widget/monido/svg-badge.svg)](https://hosted.weblate.org/engage/monido/)

Translations are managed on [Weblate](https://hosted.weblate.org/engage/monido/): pick your language, fix or approve strings, and the changes come back to this repository as a pull request.

## Documentation

- [User guide](docs/user-guide.md): the pages, the monthly update and the settings.
- [Configuration](docs/configuration.md): environment variables, sign-in modes and optional integrations.
- [Deployment](docs/deploy-docker.md): Docker, HTTPS behind a reverse proxy, updates and backups, the public demo.
- [Development](docs/development.md): running from source, the commands and the screenshots.
- [Architecture](docs/architecture.md): the code map, the data model and how-tos.
- [Finance rules](docs/finance-rules.md): how each metric is calculated and judged.
- [Database schema](docs/schema.md): the current tables and compatibility rules.
- [Design system](docs/design-system.md): tokens, components and rules for the interface.
- [Maintaining](docs/maintaining.md): the first public release and cutting a release.

## Contributing

Contributions can be code, clearer documentation, translation fixes, accessibility improvements, calculation checks or reports from a real self-hosted installation.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup and contribution guidelines. [Open an issue](https://github.com/stanislav-petryashov/monido/issues/new/choose) to report a problem or discuss an idea before a larger change. Interested in helping maintain an area over time? Tell us which part you use and would like to work on.

If Monido is useful to you, a star or a mention to someone who needs it helps the project.

## Security

Login, sessions, throttling, the Content-Security-Policy and how to report a vulnerability privately: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
