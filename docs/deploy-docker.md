# Docker deployment

One container: Node 24, a Hono server, a SQLite database in the Docker volume `data`, mounted at `/data`. A new database is created from `schema.sql`; an existing one is validated on every start and never changed, and a database with an older schema is refused (see [Updating](#updating)).

## Installation

In a new, empty folder (Linux, or Docker Desktop on macOS; Docker with Compose v2.24 or newer must be installed):

```bash
mkdir monido && cd monido
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/master/docker-compose.yml
docker compose up -d
```

That is all: no `.env` is needed (`docker-compose.yml` reads it only if it exists), no password is set in a file. Check: `curl http://127.0.0.1:8080/api/health` → `{"ok":true}`; open http://127.0.0.1:8080. If `curl` says `The requested URL returned error: 404`, the repository is not public or has moved: copy `docker-compose.yml` from a checkout. The compose file runs the `latest` image (the newest release); for the `edge` image (every `master` commit) change its tag ([Image tags](#image-tags)).

**The first sign-in.** Open the address within 15 minutes of the first start and set the family password (12 to 128 characters). The first visitor configures access, so finish before sharing the address. Until the password is set the server answers only `localhost`, an IP address or the host of `APP_URL`: set `APP_URL` first to open it by a domain name. If the window expires, run `docker compose restart app` to reopen it. The project setup wizard follows and can be skipped or rerun from Settings → Data. Telegram sign-in can then be enabled in Settings → Family and access. Only an explicit `AUTH_MODE=none` in `.env` skips sign-in; it grants full access and should be limited to a trusted, restricted network.

Settings are optional and go in a `.env` file next to `docker-compose.yml`: copy [`.env.example`](../.env.example) to `.env` and uncomment what you need. Every variable is described in [Configuration](configuration.md). After a change, `docker compose up -d` applies it.

Port 8080 taken ("port is already allocated")? Set `APP_PORT=8081` in `.env` and use that port instead.

**Where the data is.** The data (`finance.sqlite`, `session.key`) is in the Docker volume `data`, named after the folder with a `_data` suffix (`monido_data`; `docker volume ls` shows it). It needs no setup: a new volume takes the owner of `/data` from the image, the `node` user (uid 1000) the container runs as. The volume outlives `docker compose down`, restarts and image updates, but `docker compose down -v` deletes it: never add `-v`. Renaming or moving the folder changes the name, so Compose would start with a new empty volume: keep the old name with `COMPOSE_PROJECT_NAME=<old folder name>` in `.env`. Installed before 1.5.0, when this guide said `mkdir family-finance`? Your volume is `family-finance_data`: keep using that folder (or set `COMPOSE_PROJECT_NAME=family-finance`). Installed with an older `docker-compose.yml` that mounted `./data`? See [Moving from the ./data folder](#moving-from-the-data-folder). The data in a folder of a NAS owned by another user (Unraid, CasaOS/ZimaOS)? See [Running as another user](#running-as-another-user-puidpgid).

`docker-compose.yml` hardens the container: the root filesystem is read-only (`read_only: true`), so the server writes only to `/data` (the volume: the database and `session.key`) and `/tmp` (a `tmpfs`); `cap_drop: ALL` drops every Linux capability and `no-new-privileges` stops privilege escalation. Keep these lines when you adapt the file; a change that needs another writable path needs its own volume or `tmpfs` entry.

## Reverse proxy and HTTPS

The port is published on `127.0.0.1` only. A Caddy example:

```
finance.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Set `APP_URL=https://finance.example.com` so the cookie gets the `Secure` flag and the reminders get a link.

Failed logins are counted per client address, and behind a proxy the server sees the proxy's address, so every client would share one counter ([Login throttling](configuration.md#login-throttling)). Set `CLIENT_IP_HEADER` to the header the proxy puts the client address in: `X-Forwarded-For` (Caddy, nginx with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), `CF-Connecting-IP` (Cloudflare) or `X-Real-IP`. For a comma list the rightmost entry counts, the one the nearest proxy added. Set it only when the container is reachable through the proxy alone: otherwise anyone can send the header and choose their own address.

Writes are accepted only from the own origin: the server compares the request's `Host` header with the host from the browser's `Origin`. So the proxy must pass the original `Host`. Caddy does this by default; in nginx you need the line `proxy_set_header Host $host;`. If `Host` is replaced (for example with `127.0.0.1:8080`), every write returns 403.

"Restore from file" (Settings → Data) uploads the backup for preview, then uploads the same file again after confirmation (each request up to 100 MB). Caddy passes it as is. nginx refuses a body over 1 MB by default and answers 413 before the request reaches the app, so raise the limit, for both preview and restore:

```
location ~ ^/api/backup/(preview|restore)$ {
    client_max_body_size 100m;
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
}
```

Cloudflare's proxy caps a request body too (100 MB on the Free and Pro plans), so a larger database cannot be restored through it; restore it on the host instead ([Backup and restore](#backup-and-restore)).

## Resetting the family password

Forgot the password? On the server, in the install folder:

```bash
docker compose exec app reset-password
```

The command clears the stored password, selects password sign-in, signs everyone out and reopens the 15-minute window to set a new password. It writes only sign-in rows, leaving family data intact. It refuses in demo mode or while `AUTH_MODE=none` is set; remove the latter and restart before resetting. If the server is stopped, start it to open the window. In a development checkout use `npm run reset-password`: outside the image it signals no process, so restart the dev server to sign everyone out. Remove legacy `AUTH_MODE=password/telegram` and `APP_PASSWORD` lines before starting or resetting; access is configured in the web UI.

## Switching from password to Telegram

In the app, so nobody is locked out (modes and errors: [Configuration](configuration.md#sign-in-through-telegram)):

1. Create a bot with `@BotFather`. In Settings → Family and access paste its token into "Telegram bot" and click "Check and save"; set `APP_URL` in `.env` too. The bot starts at once, no restart.
2. Add yourself (your member) with "Manage users and settings", click "Invite to Telegram" and open the link in Telegram (valid 7 days, single use). Do the same for the others.
3. In "Switch to Telegram sign-in" the three checks go green (the bot, a linked manager, a test sign-in from this browser); click the button and confirm with the current family password. Everyone else is signed out.
4. To go back, "Switch to the family password" in the same block, or `docker compose exec app reset-password` if you cannot sign in.

If the app is out of reach, use the reset-password command above. Password and Telegram sign-in cannot be selected through `.env`; `TELEGRAM_BOT_TOKEN` can still supply a bot token.

Behind a reverse proxy set `CLIENT_IP_HEADER` first, or the whole family shares one sign-in limit.

## Sign-in through your identity provider

Put the `OIDC_*` lines into `.env` ([Configuration](configuration.md#sign-in-through-an-identity-provider) has the recipes for Authelia, Authentik, Pocket ID and Keycloak) with `APP_URL` on `https://`, restart, and switch in Settings → Family and access. The secret can come from a Docker secret instead of `.env`:

```yaml
services:
  app:
    environment:
      OIDC_CLIENT_SECRET_FILE: /run/secrets/oidc_client_secret
    secrets: [oidc_client_secret]
secrets:
  oidc_client_secret:
    file: ./oidc_client_secret.txt
```

Monido reaches the provider over https only. Open Monido at its `APP_URL`: a sign-in started at another address (a LAN IP) is moved there first, because the provider sends the browser back to `APP_URL`. Keep publishing the app's port on `127.0.0.1` only, as `docker-compose.yml` does: the reverse proxy is the way in.

## Claude's connector

The Advisor module can be connected to Claude (claude.ai, Claude Desktop, Claude Code) as a connector: Claude signs in through OAuth and calls the advisor's tools. The OAuth endpoints and the MCP endpoint `/mcp` (a bearer token only; stateless, JSON answers) are in place, and each member connects Claude from the app's Advisor page: it shows the address to paste into Claude, and Claude's sign-in lands on the consent screen `/advisor/connect` (no extra setup; the page is part of the app, and an unsigned visitor signs in first and returns to it). The connector works only when all of these hold:

- a sign-in selected in the web UI: **Telegram**: each connection is a person's, who confirmed it while signed in through the bot, and Claude acts with that person's rights; or **the family password**: the connection is the family's, approved by anyone signed in with the password, and Claude enters data as the family (statements, loans, spending; proposals need Telegram). Not while Telegram sign-in has no linked manager (the password fallback): the Advisor page says so;
- `APP_URL` is an `https://` address with no path (`https://finance.example.com`, not `https://example.com/finance`), **reachable from the internet**. Claude's servers fetch `/.well-known/oauth-*`, call `/oauth/register`, `/oauth/token` and `/mcp` themselves; every address the connector announces is built from `APP_URL`, not from the request, so it must be the exact public address. A home server without a public address can use your own reverse proxy with a certificate ([Reverse proxy and HTTPS](#reverse-proxy-and-https)) or Tailscale Funnel (`tailscale funnel 8080`);
- the public demo never offers the Advisor.

Otherwise `/.well-known/oauth-*`, `/oauth/*` and `/mcp` answer 404, the rest of the app works as usual, and the Advisor page says which condition is missing. The consent screen must be opened in the same browser that started the connection (the authorization request is bound to it by a cookie), so serve the app and the OAuth endpoints on the same `APP_URL` origin, as the default setup does. Do not limit the host to Anthropic's IP range: Claude Desktop and Claude Code connect from the person's own machine. Behind a proxy set `CLIENT_IP_HEADER`: failed token requests and authorization requests are limited per client address.

What ends a connection: with the family password, a password change or reset, a switch of the sign-in, a demo-data load or a wipe, or "Disconnect Claude" (anyone with the password may connect again: to end access for good, change the password); with Telegram, a switch of the sign-in (to the password and back included: the settings warn before it), unlinking or re-linking the member, or "Disconnect me"; a password change made while Telegram sign-in is on keeps them. With the connector on the family password, the sign-in form is reachable from the internet: set `CLIENT_IP_HEADER` so the login limits count per client, and note the overall login ceiling can lock the family out during an attack. Removing `AUTH_MODE=none` from `.env` brings back a family connection made before it was set (no password change happened in between).

## Claude Desktop or Claude Code on your own computer

Without Telegram, HTTPS or OAuth, Claude Desktop or Claude Code on a computer that can run `docker compose` for this installation reaches the Advisor through the `monido-mcp` command: it starts inside the running container and speaks MCP over its standard input and output, with the same tools and guide as the connector. Whoever can run it can already read the database, so it asks for no sign-in; keep it to the machine that hosts the app (or one with SSH access to it).

Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "monido": { "command": "docker", "args": ["compose", "-f", "/path/to/docker-compose.yml", "exec", "-T", "app", "monido-mcp"] } } }
```

Claude Code: `claude mcp add monido -- docker compose -f /path/to/docker-compose.yml exec -T app monido-mcp`.

- **Who acts.** A family member, with that member's current rights; changes appear in Change history as "<member> via Claude". Without `--member` it is the only member who manages the family; with several, add `--member <name>` after `monido-mcp`. A fresh installation with no members yet acts as the family and can only enter data.
- **Proposals.** With Telegram sign-in, Claude can also put forward a proposal; the server sends its cards to the family at once. In the other modes proposals are unavailable, as on the site.
- **Runs as the server's user.** The command drops to the server's own user by itself, so its database files are never root-owned, whichever user the container runs as.
- It runs beside the server on the same database and changes nothing about the connector above.

## Running as another user (PUID/PGID)

The container runs as uid 1000 and writes only `/data`. When the data folder belongs to another user (Unraid's appdata is `nobody:users` (99:100), CasaOS/ZimaOS often keep `/DATA/AppData` as root, TrueNAS uses its own ids), run it as that folder's owner. Two ways:

- **Simplest: `user:`.** `user: "99:100"` in `docker-compose.yml` (Unraid: `--user 99:100`; Umbrel and TrueNAS set it for you). The image starts as that user and changes nothing; the folder must already belong to it.
- **PUID/PGID, the NAS convention.** Start as root on purpose and name the user; the container gives the data folder to it (one level deep, links left alone) and runs the server as that user, never as root:

```yaml
services:
  app:
    user: "0:0"
    cap_add: [CHOWN, SETUID, SETGID]
    environment:
      PUID: "99"
      PGID: "100"
```

Without `user: "0:0"` the PUID/PGID are not used (the log says so when they differ from the user the container runs as): the shipped `docker-compose.yml` drops every capability, so a root start must add back these three. Without them the container stops at once with a line naming them; a PUID or PGID that is not a number stops it too; `PUID: "0"` runs the server as root and warns. The folder and every file directly in it are checked at each start, so a file left by another user is handed over too. On a network share (NFS with root squash, SMB) the owner may not be changeable, and a private folder (mode 0700) of another user cannot be read without also adding `DAC_READ_SEARCH` to `cap_add`: the container warns and starts, and if it cannot write the folder the log says so. The commands (`reset-password`, `monido-mcp`) and `docker compose exec app as-server …` run as the server's user in every mode. With rootless Docker keep the default: uids inside the container map to other ids on the host.

## Exchange rates

The server downloads the exchange rates of the project's currencies from the public [Frankfurter](https://frankfurter.dev) API (`https://api.frankfurter.dev`, no key) and keeps them in the database, so the container needs outbound HTTPS. To keep these requests in your own network, run a Frankfurter container and set `FX_API_URL` to its address (for example `FX_API_URL=http://frankfurter:8080` on the same Docker network). Without access to the API the dashboard uses the rates already stored and warns about the dates it had to borrow a rate for.

## Telegram reminders

Create a bot with `@BotFather`, paste the token in Settings → Family and access ("Telegram bot"; or set `TELEGRAM_BOT_TOKEN` in `.env`), and link a chat in "Settings → Telegram reminders". The same token runs the sign-in bot ([Configuration](configuration.md#the-bot)); use it in one place only. The hour is checked once an hour, on the hour, in the time zone from the settings.

## Updating

In the install folder:

```bash
docker compose pull
docker compose up -d
```

`pull` fetches the newest image of the tag in `docker-compose.yml` and `up -d` recreates the container on it; the data in the volume stays. The compose file itself changes rarely (the release notes say when): then download the new one over the old one, from the release you want:

```bash
curl -fsSLO https://raw.githubusercontent.com/stanislav-petryashov/monido/vX.Y.Z/docker-compose.yml
docker compose pull && docker compose up -d --remove-orphans
```

Keep local edits (a pinned tag such as `:1.4.0` or a `@sha256:` digest, another port, a proxy network) in `docker-compose.override.yml` next to it: Docker Compose reads that file too, and the download never touches it. Never add `-v` to `docker compose down`: it deletes the data volume.

**Back up before updating** (Settings → Data → Download database copy, or [on the host](#backup-and-restore)). Empty databases are created from `schema.sql`; an existing database of an older schema version is updated at start, after a copy of it (`before-upgrade-v<version>-<date>.sqlite` in the data folder) is written, and then validated ([Database schema](schema.md#schema-version-and-legacy-bookkeeping)). Installations and backups updated through the former `0031_family_telegram.sql` are accepted and updated the same way; older schemas are refused: use the previous release to update and export them first. The release notes say when an update changes the schema.

### Moving from the ./data folder

An older `docker-compose.yml` mounted the folder `./data` (`- ./data:/data`); the current one keeps the data in the volume `data`. An installation that keeps its old `docker-compose.yml` goes on working as before. To move to the volume, copy the data into it once, before the first start with the new file (the copy refuses nothing, so do it only into a volume that has no database yet):

```bash
docker compose down
# replace docker-compose.yml with the new one, then copy ./data into the volume (as the app's own user):
docker compose run --rm --no-deps -v "$PWD/data":/from:ro app sh -c 'cp -a /from/. /data/'
docker compose up -d
```

Check that the family's data is there, then keep `./data` as a backup for a while or delete it. If `cp` says "Permission denied", the folder belongs to root: `sudo chown -R 1000:1000 data` and run it again.

## Image tags

The image `ghcr.io/stanislav-petryashov/monido` is published for amd64 and arm64 with these tags:

| Tag | What it is |
| --- | --- |
| `latest` | the newest release; `docker-compose.yml` uses it, so `docker compose pull` brings the newest release |
| `X.Y.Z` (for example `1.4.0`) | one release, unchanged once published; pin it to update only when you choose to |
| `edge` | the newest build of `master`, for testing what comes next; not for a family's real data |
| `sha-abc1234` | the `master` build of that commit; the release workflow promotes it, you do not need it |

A `master` build reports a version like `1.4.0-3-gabc1234`, a release its plain `1.4.0`. The update notice in Settings compares the running version with the greatest `X.Y.Z` tag only, so `edge` and `sha-…` never announce themselves. A release is not rebuilt: it is the `master` image of the same commit, already checked, and the same commit's build was smoke-tested; how it is published is in [Maintaining](maintaining.md#cutting-a-later-release).

## Public demo

The demo is the same image with `AUTH_MODE=demo` (what the mode does: [Configuration](configuration.md)). It runs on its own host, apart from any real data: its volume holds only generated data and may be deleted at any time.

The demo is not indexed: every answer carries `X-Robots-Tag: noindex, nofollow`, `/robots.txt` disallows everything and there is no sitemap (password mode is unchanged).

### One-time host setup

1. Install Docker, Docker Compose 2.24+ and Caddy on the host. Caddy runs as a host service, outside Compose. On the host make a folder (for example `family-finance-demo`) and copy `deploy/demo/docker-compose.demo.yml` and `deploy/demo/demo-update.sh` from the repository into it (`chmod +x demo-update.sh`).
2. Create `.env` next to them. Compose reads it for the variables of the file: `DEMO_PASSWORD` (default `demo-family`, shown on the sign-in screen), `DEMO_INSTALL_URL` (where "Install it yourself" leads; default the repository) and `APP_URL` (the demo's public address, for example `https://demo.example.com`; required: compose refuses to start without it).
3. Start it: `DEMO_TAG=1.4.0 docker compose -f docker-compose.demo.yml up -d` (the released version, without the `v`; see [Image tags](#image-tags)).
4. Check: `curl http://127.0.0.1:8080/api/health` → `{"ok":true}`.

The container is limited to 0.5 CPU and 512 MB of memory (`cpus`, `mem_limit`), and its port is bound to `127.0.0.1`: HTTPS comes from the layer in front of it. Disk use is bounded by the server, not by Docker: the visitors' copies are capped in size and number (the [`demo` mode](configuration.md#demo)), at most about 500 MB besides the template; the visitors cannot download a database copy, and `/tmp` is a 64 MB tmpfs.

### HTTPS and the domain

Point the domain's DNS records at this host and allow inbound ports 80 and 443 to Caddy. For direct access, use DNS-only records (no Cloudflare proxy). Keep the app's published port on `127.0.0.1:8080`, not `0.0.0.0`: only Caddy should expose the application. Set `APP_URL=https://demo.example.com` in the demo's `.env` and add this site to `/etc/caddy/Caddyfile` (replace the example domain):

```caddyfile
demo.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Validate and reload Caddy without restarting it:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl --fail https://demo.example.com/api/health
```

Caddy manages HTTPS certificates and forwards the original Host to this HTTP upstream. The demo compose file reads `X-Forwarded-For`, which Caddy sets, so the limit of two visitors per client address applies separately to visitors. No custom forwarding headers or cache are needed. Keep API responses uncached; the application supplies `no-store` for `/api/*` and cache headers for its hashed assets. See [Caddy's reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

If Cloudflare's proxy (orange cloud) or another proxy remains in front of Caddy, this is a different trust chain: configure trusted proxies and a verified client-IP header together before using it. The application takes the **rightmost** comma-separated address, so enabling Caddy's trusted proxies alone does not make an arbitrary forwarded chain suitable. Do not trust visitor-supplied `CF-Connecting-IP` on a publicly reachable origin.

### Updating

```bash
cd family-finance-demo
./demo-update.sh v1.4.1
```

The script is kept to let active sessions finish, clean up maintenance mode on failure, and verify the replacement container; a plain pull/up would interrupt visitors immediately. It pulls the tag first while the old container keeps running (a failed pull stops it with exit code 3, nothing is touched), creates `/data/drain` in the container so that new sign-ins get "being updated, try again in a few minutes", and checks `/data/demo-status.json` every 15 seconds until no session is live. Visitors' sessions last 15 minutes, so this takes up to that long; after 20 minutes it goes on with a warning. The status counts only when it shows `"draining":true` (the server writes it once a minute, so right after the flag the file may still be the old one). Then it runs `docker compose up -d --no-deps --wait --wait-timeout 180 demo` on the new tag: Compose waits for the image health check, and the script removes the drain flag whether startup succeeds or fails. Only the `demo` service is pulled and recreated; Caddy is untouched. A failed startup or health check returns exit code 1, without claiming a successful update or automatically rolling back. The flag lives in the volume and the server notices its removal on the next tick: sign-ins may still be refused for up to a minute after "Done". `DEMO_COMPOSE_FILE`, `DEMO_DATA_DIR`, `DEMO_POLL_SECONDS`, `DEMO_WAIT_SECONDS` and `DEMO_HEALTH_SECONDS` override the file name, the container's `DATA_DIR`, the polling and drain intervals, and the health timeout. Use a positive health timeout.

### Updating from GitHub (optional)

`.github/workflows/demo-deploy.yml` runs the same script over SSH, by hand (Actions → demo-deploy → Run workflow, with the tag) or as the last job of a `vX.Y.Z` tag's `docker` run, once the release image is promoted (other tags such as `v1.4.0-rc.1` are never deployed). It retries only a failed pull (exit code 3), every 30 seconds for up to 3 attempts; any other failure stops the job. It does nothing until the repository has the secret `DEMO_SSH_HOST`; the others are `DEMO_SSH_PORT` (if not 22), `DEMO_SSH_USER`, `DEMO_SSH_KEY` (a private key of a user who may run Docker), `DEMO_SSH_KNOWN_HOSTS` (the host's `ssh-keyscan` line) and, if the folder is not `family-finance-demo` in the user's home, `DEMO_DIR`. The script must be in that folder as `demo-update.sh`. For an existing deployment in a differently named folder, set `DEMO_DIR` to that existing path before the next workflow run; do not rename the folder or its Docker volumes to match the new project name. Never commit these values.

Give the workflow its own key and limit it to the update: copy `deploy/demo/demo-ci-deploy.sh` into the same folder and add the key to the host user's `~/.ssh/authorized_keys` as `restrict,command="/full/path/to/demo-ci-deploy.sh" ssh-ed25519 AAAA… demo-deploy`. Whatever command the workflow sends, that key can then only run `demo-update.sh` with the release tag found in it (no shell, no port forwarding); a stolen key can at most redeploy a published version.

## Backup and restore

- From the application: "Settings → Data → Download database copy". The server makes a consistent snapshot (`VACUUM INTO`) and serves the file `finance-YYYY-MM-DD.sqlite`; it works on a running server and on Docker Desktop. The file holds all of the family's financial data: keep it where outsiders cannot reach it.
- The most reliable way is with the container stopped: `docker compose stop`, then `docker compose cp app:/data/finance.sqlite backup-$(date +%F).sqlite` (and `docker compose cp app:/data/session.key session.key`, so the family is not signed out after a restore), `docker compose start`.
- On a running server, make a consistent copy inside the container and take it out:

  ```bash
  docker compose exec app as-server node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/finance.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
  docker compose cp app:/data/backup.sqlite backup-$(date +%F).sqlite
  docker compose exec app as-server rm /data/backup.sqlite
  ```

  `VACUUM INTO` does not overwrite a file: if `/data/backup.sqlite` is left over from last time, remove it first.
- Restore from the application: "Settings → Data → Restore from file" takes a copy made by "Download database copy" (at most 100 MB), validates its current schema for a read-only preview, then after explicit confirmation keeps the current database as `/data/before-restore-YYYYMMDD-HHMMSS.sqlite` in the volume and swaps the data in one transaction; a file that does not pass the checks changes nothing. Remove old `before-restore-*` files yourself when they are no longer needed (`docker compose exec app sh -c 'rm /data/before-restore-*'`).
- Restore by hand: put the copy next to `docker-compose.yml` as `restore.sqlite`, readable by uid 1000 (`chmod 644 restore.sqlite`), then replace the database in the volume and drop its WAL files (the database runs in WAL mode):

  ```bash
  docker compose stop
  docker compose run --rm --no-deps -v "$PWD/restore.sqlite":/restore.sqlite:ro app sh -c 'rm -f /data/finance.sqlite-wal /data/finance.sqlite-shm && cp /restore.sqlite /data/finance.sqlite'
  docker compose start
  ```

A database copy carries the family password's hash and the Telegram bot token (stored in clear in the `app_settings` table), as it already carries the invitation hashes and the reminders' chat: keep backups private. A restore keeps the current sign-in settings (password, mode, token) and the reminders' linked chat, and does not bring back the file's.

Sessions are signed with a key derived from `/data/session.key` (or `SESSION_SECRET`), the sign-in mode and a generation counter that every password or mode change raises: changing the password or the mode, or deleting `/data/session.key` (`docker compose exec app rm /data/session.key`, then `docker compose restart`), signs everyone out, and each person has to sign in again. Use this if the password leaks.

## Troubleshooting

Look first at what is running and what the app says, in the install folder:

```bash
docker compose ps                    # is the app running and healthy?
docker compose logs --tail 50 app    # the last lines of its log
curl http://127.0.0.1:8080/api/health   # {"ok":true} when it answers (use your APP_PORT)
```

The usual problems, what they look like, and what to do:

| Symptom | Cause and action |
| --- | --- |
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | another program or container holds the port: set `APP_PORT=8081` in `.env` (create the file if there is none) and run `docker compose up -d` |
| a container with no network after a failed start | a container lost its Docker network: `docker compose up -d --force-recreate` |
| the site shows a Cloudflare sign-in page with an emailed code, or Claude's connector cannot connect | Cloudflare Access is in front of the hostname, and Claude cannot pass its login: remove it (Zero Trust → Access → Applications) or bypass `/mcp`, `/oauth/*` and `/.well-known/*` |
| `[bot] getMe: telegram.unavailable` in the app's log | the app cannot reach Telegram. A container with no network first (`docker compose up -d --force-recreate`); otherwise check from inside the container: `docker compose exec -T app node -e "fetch('https://api.telegram.org').then(r=>console.log(r.status)).catch(()=>console.log('fail'))"`; `fail` means the machine's internet, DNS or firewall |
| a feature from the changelog is missing | the `latest` image is the newest release; a change merged since is only in `edge`: wait for the release, or use the `edge` tag ([Image tags](#image-tags)) |
| `[config] APP_URL is on https but CLIENT_IP_HEADER is unset …` behind a proxy | the whole family shares one sign-in limit: set `CLIENT_IP_HEADER` to the header your proxy sets with the client address (`X-Forwarded-For` for Caddy, `CF-Connecting-IP` behind Cloudflare), then `docker compose up -d` |
| the container exits immediately, the log shows `[config] …` | wrong `.env` variables: the text names the variable |
| `[config] cannot write to DATA_DIR (/data) as uid …` | the data folder belongs to another user: run the container as its owner, or give it to uid 1000 ([Running as another user](#running-as-another-user-puidpgid)) |
| `Database schema is incompatible` | the database does not have the current structure; use the previous release to update it and export a new backup before switching |
| `Database schema is incompatible` | the database does not have the current structure; use the previous release to update it and export a new backup before switching |
| 403 on every write while reads work | the proxy replaces `Host`; pass the original (`proxy_set_header Host $host;`) |
| 429 on login | 10 wrong passwords (or Telegram sign-in starts) in a minute from one address (or one IPv6 /64), or 100 wrong passwords from all addresses together (sign-in starts do not count toward this one); wait a minute. If 10 already block everyone, the server sees only the proxy's address: set `CLIENT_IP_HEADER` |
| everyone is back on the login screen after a restart | the password or mode changed or `/data/session.key` was deleted; sign in again |
| the sign-in screen says the time to set the password has passed | nobody set the family password within 15 minutes of the start: `docker compose restart app`, then open the site and set it |
| forgot the family password | `docker compose exec app reset-password`, then open the site within 15 minutes ([Resetting the family password](#resetting-the-family-password)) |
| the Telegram bot token setting is read-only | `.env` holds `TELEGRAM_BOT_TOKEN`; delete it, then run `docker compose up -d` |
| the bot stopped writing after the token was replaced | each member opens the new bot and presses Start; if Telegram refuses the token, Settings → Family and access shows it: paste a working one |
| `[config] cannot write to DATA_DIR (/data)`, or `unable to open database file` | an older `docker-compose.yml` mounts `./data`, which Docker created as root: move the data into the volume ([Moving from the ./data folder](#moving-from-the-data-folder)), or `sudo chown -R 1000:1000 data` and `docker compose up -d`. With the volume: `docker compose run --rm --no-deps --user root --cap-add CHOWN --entrypoint chown app -R 1000:1000 /data && docker compose up -d` |
| the family's data is gone after `docker compose up -d` | the volume's name follows the folder: the folder was renamed or moved, or `docker-compose.yml` was replaced by the new one while the data was still in `./data`. Nothing is deleted: set `COMPOSE_PROJECT_NAME` to the old folder name in `.env`, or move the data ([Moving from the ./data folder](#moving-from-the-data-folder)) |
