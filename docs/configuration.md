# Configuration

The server reads its settings from environment variables once, at startup. In Docker they come from `.env` (`env_file` in `docker-compose.yml`); start from `.env.example`. A wrong value stops the server with a `[config] …` line that names the variable.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_MODE` | unset | `none`: temporary full access without sign-in; `demo`: isolated public demo. Both are environment-only. Leave unset for Password or Telegram configured in the web UI |
| `DEMO_PASSWORD` | `demo-family` | `demo` mode only: the password the demo's sign-in screen shows as a hint, at least 8 characters |
| `DEMO_INSTALL_URL` | `—` | `demo` mode only: the `http://` or `https://` address "Install it yourself" opens (the repository or the install guide) |
| `SESSION_SECRET` | generated | cookie signing key, at least 32 characters; without it the server creates `session.key` in `DATA_DIR`. Deleting `session.key`, and any password or mode change, signs everyone out |
| `CLIENT_IP_HEADER` | `—` | the header the reverse proxy puts the client's address in (`X-Forwarded-For`, `CF-Connecting-IP`, `X-Real-IP`), so failed logins are counted per address. Set it only when the proxy is the sole way in (see [Login throttling](#login-throttling)) |
| `APP_URL` | `—` | the site address: the link in Telegram reminders; `https://` turns on `Secure` for the cookie. While nobody signs in (`AUTH_MODE=none`, or a new installation waiting for its first password) its host is the only name the server answers besides `localhost` and IP addresses, so set it before opening the app by a domain name. Claude's connector needs it on `https://` with no path and reachable from the internet, and builds every address it announces from it (see [Claude's connector](deploy-docker.md#claudes-connector)) |
| `TELEGRAM_BOT_TOKEN` | `—` | override: the bot token (from `@BotFather`), normally entered in Settings → Family and access. The bot links the reminders' chat and, in `telegram` mode, signs people in. The bot runs whenever it is set (not in `demo` mode), see [The bot](#the-bot) |
| `OIDC_ISSUER` | `—` | the family's OpenID Connect provider (Authelia, Authentik, Pocket ID, Keycloak…): its issuer URL on `https://`, copied exactly as the provider shows it, trailing slash included. With `OIDC_CLIENT_ID` and a secret it lets Settings → Family and access offer sign-in through the provider (see [Sign-in through an identity provider](#sign-in-through-an-identity-provider)). Needs `APP_URL` on `https://` |
| `OIDC_CLIENT_ID` | `—` | the client id registered for Monido at the provider |
| `OIDC_CLIENT_SECRET`, `OIDC_CLIENT_SECRET_FILE` | `—` | the client secret, or a file holding it (a Docker secret); the variable wins when both are set. A missing or unreadable secret never stops the server: Settings names the problem and the provider mode stays off |
| `FX_API_URL` | `https://api.frankfurter.dev` | the address of the [Frankfurter](https://frankfurter.dev) exchange-rate API the server downloads rates from; point it at a self-hosted Frankfurter container to keep rate requests in your network |
| `DATA_DIR` | `/data` in Docker | the folder with `finance.sqlite` and `session.key`. Outside Docker: `./data` for the built server (`npm start`), `./data-dev` for `npm run dev`, where a `DATA_DIR` line in `.env` has no effect (see [Development](development.md#local-development)) |
| `APP_VERSION` | `dev` | the version shown in the menu; the published image sets it itself at build time (`git describe --tags`), so there is no need to set it |
| `UPDATE_CHECK` | on | `off`, `false` or `0` stops the daily check of the public image's latest tag on `ghcr.io` (only the image name is sent, never family data); always off in `demo` mode. A failed check is silent |
| `HOST`, `PORT` | `0.0.0.0`, `8080` | the address and port the server listens on |
| `APP_PORT` | `8080` | read by Docker Compose, not by the server: the host port `docker-compose.yml` publishes the app on at `127.0.0.1` (when 8080 is taken). The container still listens on 8080, so a tunnel or another container reaches it at `http://app:8080` either way; a reverse proxy on the host points to the new port |

Empty variables count as unset. Non-empty `APP_PASSWORD` and any `AUTH_MODE` other than `none` or `demo` stop startup with migration instructions. Remove those legacy lines; previously saved Password/Telegram modes and password hashes remain available. A legacy `auth_mode=none` stored in the database is treated as Password, requiring the saved password or opening password setup if no hash exists; only `AUTH_MODE=none` can disable sign-in. Short demo passwords (under 8 characters), invalid demo URLs, short session secrets (under 32 characters), invalid ports and unwritable data directories also stop startup. Outside `demo`, `DEMO_*` variables are ignored.

## Sign-in settings in the app

Password and Telegram sign-in and the family password are managed in Settings → Family and access → Sign-in. The selector offers only `password` and `telegram`. `none` and `demo` are selected only through `.env`. `AUTH_MODE=none` temporarily disables sign-in, grants full permissions to everyone who can reach the server and locks the web sign-in controls. It preserves the saved database mode and password: remove the line and restart to restore them. Use it only on a trusted, restricted network. The project wizard and same-origin checks still apply, and the server answers only requests addressed to `localhost`, an IP address or the host of `APP_URL` (403 otherwise): a foreign website cannot point its own name at the server (DNS rebinding) and use it without sign-in. Set `APP_URL` to reach it by a name. Behind a reverse proxy the proxy must pass the browser's original `Host` header: one that sends its own (such as `localhost`) turns this guard off. `npm run dev` binds to `127.0.0.1` through `dev.env` and uses the saved web settings.

- **The first visitor.** With no saved password and no environment override, open a new installation within 15 minutes and set the family password (12 to 128 characters). Until then the server answers only `localhost`, an IP address or the host of `APP_URL`, as with `AUTH_MODE=none`. Telegram can then be enabled through its guided setup. Restart the server if the setup window expires. `AUTH_MODE=none` skips this password prompt.
- **The password** is stored as a salted scrypt hash in the database, never in clear. Changing it in the app asks for the current one and signs the others out.
- **The bot token** is checked with Telegram before it is saved, and stored in clear in the database (the bot has to use it): a database copy carries it. It is never shown again.
- **The switch** to Telegram sign-in is guided and needs a connected bot, a linked manager and a test sign-in; select Password to return, keeping the saved password or setting a new one. If Telegram sign-in was switched off at start (no manager with a linked Telegram), "Stay on the family password" keeps the password for good; otherwise Telegram comes back at the next start once a manager links Telegram, and until then the bot cannot be disconnected. Remove `AUTH_MODE=none` and restart before changing sign-in in the web UI.
- **Recovery:** `docker compose exec app reset-password` clears the password, selects password sign-in, signs everyone out and opens a window to set its replacement ([Resetting the family password](deploy-docker.md#resetting-the-family-password)).

## Login modes

Without a login the API answers 401. In `password` mode everyone who is signed in has the same rights in the application: they can read and change all the data, and every edit is written to the journal with its author. In `telegram` mode, the rights of the person's account apply (see [Family and rights](#family-and-rights)).

### `password`

One shared family password. A successful login sets a signed cookie for 30 days (`HttpOnly`, `SameSite=Lax`, `Secure` when `APP_URL` is https). The key is derived from `session.key` in `DATA_DIR` (or `SESSION_SECRET`), the sign-in mode and a generation counter that every password or mode change raises, so deleting `session.key`, or changing the password in the app or the mode, signs everyone out; use this if the password leaks. Edits are logged with the author `family`.

### Sign-in through Telegram

Every person has an account (Settings → Family and access) linked to their Telegram, and signs in by confirming in the bot: "Sign in with Telegram" → open the bot → Start → Confirm. No shared password. The session lasts 30 days like the others; edits are logged with the person's member name.

Choose Telegram in Settings → Family and access. It requires a connected bot, a linked manager and a confirmed test sign-in. `TELEGRAM_BOT_TOKEN` can still supply the bot token from the environment; it does not select the sign-in mode. If no manager has a linked Telegram at startup, the server falls back to the saved family password or opens setup when there is none.

**Recovery.** If Telegram is unavailable, run `docker compose exec app reset-password`, set a new family password in the browser, repair the bot or member settings, then switch back through the web UI. See the [deployment guide](deploy-docker.md#switching-from-password-to-telegram).

**Sign-in attempts** live 5 minutes and are single-use. At most 5 live attempts per address and 1000 in all are kept. When all 1000 are live, the oldest unconfirmed attempt of the address holding the most makes room (IPv6 addresses count together by their /48 here), but only of one holding more than one and more than the one starting: a single attempt and one already confirmed in the bot are never pushed out. Otherwise the start is refused ("Too many sign-ins through Telegram are waiting"); attempts expire within 5 minutes. Starting one counts against the sign-in limit (see [Login throttling](#login-throttling)); behind a reverse proxy set `CLIENT_IP_HEADER`, or the whole family shares one limit. "Confirm" in the bot protects against someone sending you their sign-in link: you confirm only an attempt you started.

### Sign-in through an identity provider

Every person has an account linked to their account at the family's OpenID Connect provider, set by the `OIDC_*` variables above, and signs in through it. Rights, family votes and personal Claude connections work as in the Telegram mode; the bot keeps sending reminders and vote cards to those who linked Telegram, but nobody signs in through it.

### `demo`

The public demo: each visitor signs in with `DEMO_PASSWORD` (shown on the sign-in screen) and gets a private copy of a fictional family for 15 minutes. Inside that copy every request is signed in, and edits are logged with the author `demo`. Nothing leaves the server: exchange rates are never downloaded (the demo data carries every rate it needs; manual rates still work), and the demo has no Telegram reminders and no advisor: their pages, Settings tab, API and Claude's connector are absent there.

The supplied [public demo deployment](deploy-docker.md#https-and-the-domain) uses Caddy as a host service, forwarding to `127.0.0.1:8080`, with `CLIENT_IP_HEADER=X-Forwarded-For`. Its compose file has no tunnel service.

The demo is the same server and the same image: set `AUTH_MODE=demo` (plus `DEMO_PASSWORD` and `DEMO_INSTALL_URL` if wanted) and start it as usual: `npm start`, or the container with these variables in `.env`. In this mode the server never opens `DATA_DIR/finance.sqlite` and creates no `session.key`: it builds the demo data into `DATA_DIR/demo` at startup and again every day at 00:05 UTC, keeps visitors' copies in `DATA_DIR/demo/sandboxes` (deleted when they expire and at every start), and signs cookies with a key held in memory, so a restart signs everyone out. At most 15 visitors at once, and 2 per client address (the rightmost `CLIENT_IP_HEADER` entry behind a proxy, as for login throttling); one visitor may start over once in 10 seconds. Each copy may grow to 16 MB: past that a save answers "The demo database is full. Start over to reset it", and starting over gives a fresh copy. A visitor may add up to 10 accounts to the family's own (the next answers `demo_account_limit`), each copy has at most 8 requests in flight (the next answers 429 `demo_too_many_requests` at once, not queued), a request body still arriving after 30 seconds is cut, and the history import's preview is refused like the import: one visitor cannot slow the server down or fill its memory for the others. Its WAL file can reach about as much again, so the volume holds at most about 500 MB besides the template (15 full copies). Signing out keeps the visitor's copy until it expires, so a sign-in/sign-out loop cannot get past the per-address cap. A database copy cannot be downloaded in the demo. Every minute it writes `DATA_DIR/demo-status.json` (`live`, `draining`, `lastExpiresAt`, `updatedAt`); while a file `DATA_DIR/drain` exists, new sign-ins are refused with "being updated" and live sessions run until they expire. This is the way to update the demo without cutting anyone off.

## Family and rights

Settings → Family and access lists all family members, including those without sign-in access. Members with access have individual rights: enter data, vote, manage users and settings. None of them means view only; everyone sees everything. A new user gets enter data and vote. The last person who can manage cannot lose that right or be deleted: in `telegram` mode that is the last one with a linked Telegram. In `telegram` mode the only user cannot be deleted either; under the family password the last user may go, and the mode works as before users. User changes are written to the journal but cannot be reverted; a wipe and a restore keep the users. What each right allows is in the [user guide](user-guide.md#family-and-rights).

## The bot

The bot is started whenever there is a bot token (`TELEGRAM_BOT_TOKEN`, or one saved in Settings → Family and access, where it starts at once with no restart) in any mode except `demo`: it links the reminders' chat as soon as it receives `/start <code>`, takes invitations and signs people in. It reads Telegram by long polling, and Telegram allows **one reader per token**. A webhook set on the bot, or another program reading it, stops the reader; that includes `npm run dev` started with the production token. Settings → Family and access shows the problem in the Telegram bot block, and so it does for a token Telegram refuses. Remove the webhook or stop the other reader and the bot recovers by itself. Create a separate bot for development.

## Login throttling

In `password` mode 10 wrong passwords within a minute from one address (an IPv6 address by its /64) block login from that address until the minute ends, and 100 from all addresses together block it for everyone. In `telegram` mode every started sign-in counts against the same per-address limit (10 per minute). In `demo` mode only the per-address limit applies: the password is public, and a global one would let anyone lock every visitor out. The address is the socket's, or the rightmost entry of `CLIENT_IP_HEADER` when that is set.

Behind a proxy without `CLIENT_IP_HEADER` every client has the proxy's address and shares one counter, so an outsider who reaches the login page can keep blocking the family's login. With the header set but the port reachable directly, a client can send a new address with every attempt, leaving only the global ceiling. With `APP_URL` on `https://` and no `CLIENT_IP_HEADER` (password or telegram mode) the server logs one `[config] APP_URL is on https but CLIENT_IP_HEADER is unset …` warning at startup. The details are in [SECURITY.md](../SECURITY.md); the header for each proxy is in the [deployment guide](deploy-docker.md#reverse-proxy-and-https).

### Personal messages and shared chats

Expand a member in Settings → Family and access to invite them to Telegram, choose personal reminders, council proposals, bot commands and sign-in, or change their rights. **Bot commands** turns `/help` and `/summary` on or off for that member; votes on a council card, the comment after a vote and Withdraw work either way. Turning off personal access keeps the member and their financial records. Renaming a member updates their ownership references and open month drafts together; rename again to undo it (the compound journal entry cannot be reverted).

Shared chats follow the Telegram bot block. Add the bot to the group and send the generated `/pair@bot_name` command from a linked manager’s Telegram account within ten minutes. Each code works once. New groups start with all messages off; enable reminders, read-only council notices or commands separately. Group commands require an explicit bot mention and a linked sender with commands enabled. `/help` explains the commands; `/summary` shows recorded family financial data to everyone in that chat. Voting, comments and sign-in stay in private messages. No language-model conversation is connected by this setting.

## Database schema

`SCHEMA_FILE` overrides the path to `schema.sql` (default: `./schema.sql`). The file initializes empty databases only. Existing databases must already have the current schema; the former `MIGRATIONS_DIR` setting is no longer used.
