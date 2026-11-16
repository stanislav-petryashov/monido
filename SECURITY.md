# Security

The application is intended for a single person or family. Login is by a shared password or through Telegram confirmation. The mode, the password and the bot token are managed in the app (Settings → Family); only `TELEGRAM_BOT_TOKEN` can override the bot token in `.env`; `AUTH_MODE=demo` selects the separate demo; the variables are in [docs/configuration.md](docs/configuration.md), the deployment in [docs/deploy-docker.md](docs/deploy-docker.md). Everyone who is logged in can read all data; there is no isolation between families. Under the family password everyone can also change everything; with Telegram sign-in each account's rights (enter data, vote, manage users and settings) limit what it may change ([Family and rights](docs/configuration.md#family-and-rights)). Edits made through the application are written to the log with their author (`family` or the member's name); edits made directly in SQLite do not reach the log.

In `password` mode the server sets a signed cookie for 30 days (`HttpOnly`, `SameSite=Lax`, `Secure` when `APP_URL` is https). The signing key is derived from `session.key` in `DATA_DIR` (or `SESSION_SECRET`, at least 32 characters), the sign-in mode and a generation counter that every password or mode change raises: any of those changes, or deleting `session.key`, logs everyone out. Writes are accepted only from the own origin. While nobody signs in (`AUTH_MODE=none`, or the first-password window) requests must be addressed to `localhost`, a literal IP address or the host of `APP_URL`, any port; any other name gets 403 `host_not_allowed`, so a foreign site cannot rebind its own name to the server (DNS rebinding) and read or change data as same-origin. Set `APP_URL` to open the app by a name in those states. Behind a reverse proxy the guard works only when the proxy passes the browser's original `Host` header; one that rewrites it (for example to `localhost`) turns the guard off. Pages carry a Content-Security-Policy: scripts, connections, fonts and images only from the own origin (images also `data:` and `blob:`), no inline scripts, no framing; styles allow `'unsafe-inline'` for the chart tooltips. Paths with a segment starting with a dot (such as `/.vite/manifest.json`) are not served.

Family password and bot token:

- **Storage.** The password set in the app is stored only as a salted scrypt hash (N=2^16, r=8, p=2, 16-byte salt, 32-byte key; older N=2^15, p=1 hashes still verify) in `app_settings`, compared in constant time. The journal records a change as `***`.
- **First visitor.** A new installation opens a 15-minute window to set the family password. Open the address yourself and set it before sharing the address. Restart the server if the window expires. The environment-only `AUTH_MODE=none` skips sign-in and this prompt, grants full access to anyone who can reach the server and preserves saved sign-in settings; remove it and restart to restore them. Use it only on a trusted, restricted network.
- **Reset.** `docker compose exec app reset-password` (needs shell access to the host) clears the password, signs everyone out and reopens the 15-minute window; the journal records it as "Server configuration".
- **Bot token at rest.** The Telegram bot token set in the app is stored in clear in `app_settings` (the server has to use it), so it travels with every database copy and backup, as the password hash, the invitation hashes and the reminders' chat do: keep backups private. A restore keeps the live sign-in rows, so a backup cannot bring back an old password or a revoked token.
- **Sessions.** Raising the generation (a password or mode change, the reset) invalidates every earlier cookie at once.
- **Order of checks.** Each wrong-password attempt is counted before the slow scrypt verification, so concurrent requests cannot slip past the limit.

Login throttling (password mode):

- **Per address.** 10 wrong passwords within a minute from one address block login from that address until the minute ends. A successful login clears that address's count (not the global ceiling's). Everyone behind one address shares it (a home router, or a proxy without `CLIENT_IP_HEADER`), so a family member who signs in also clears the failures of anyone else guessing from that same address; the global ceiling still bounds such guesses.
- **IPv6 by /64.** An IPv6 address counts by its /64 prefix, since one subscriber usually holds a whole /64; an IPv4-mapped address (`::ffff:a.b.c.d`) counts as the plain IPv4. At most 10 000 addresses are tracked; when that fills up, expired windows are dropped first, then the oldest address.
- **Global ceiling.** 100 wrong passwords within a minute from all addresses together block login for everyone until the minute ends. So the total stays at about 100 guesses a minute however many addresses an attacker holds, but a sustained flood from many addresses can still pause the family's login for a minute at a time. Telegram sign-in starts and setting the first password guess no secret: they count per address only, never toward this ceiling.
- **Telegram sign-in attempts.** At most 5 live attempts per address (IPv6 by its /64, as above) and 1000 in all; a full store makes room only from the address, or IPv6 /48, holding the most (more than one and more than the one starting), never by dropping a single or confirmed attempt. An attacker controlling about 1000 distinct IPv4 addresses or IPv6 /48 prefixes can still block new Telegram sign-ins while the flood lasts.
- **Which address.** The socket's, or the rightmost entry of `CLIENT_IP_HEADER` when that is set. Behind a proxy without `CLIENT_IP_HEADER` every client has the proxy's address and shares one counter, so an outsider who reaches the login page can keep blocking the family's login for a minute at a time. Set `CLIENT_IP_HEADER` only when the proxy is the sole way in: a client that reaches the port directly can send a new address with every attempt, leaving only the global ceiling.


The shipped `docker-compose.yml` runs the container with a read-only root filesystem, no Linux capabilities and `no-new-privileges`, and publishes the port on `127.0.0.1` only (see [docs/deploy-docker.md](docs/deploy-docker.md#installation)).

Do not keep `.env`, `data/`, `data-dev/`, backups, SQL dumps and statements in Git, including its history: `.gitignore` does not remove files that are already tracked.

## Reporting a vulnerability

Open the repository's **Security** tab on GitHub and click **Report a vulnerability**. This is a private report that only the owner can see (the button appears once the owner has enabled private vulnerability reporting in Settings → Code security). Do not publish tokens, real data or a reproducible access bypass in Issues.

## Supported versions

Security fixes go into the latest release only; there are no fixed timelines. Back up the database (`finance.sqlite` in `DATA_DIR`) before updates: [Backup and restore](docs/deploy-docker.md#backup-and-restore).
