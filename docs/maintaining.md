# Maintaining

Notes for the repository owner: the one-off steps of the first public release and the routine of cutting a later release.

## First public release (v1.0.0)

Do these in order. The first public push is the first commit of a new, empty repository, not this repository made public: the public repository starts from the current tree alone.

1. Choose the final `owner/repo` and create a new, empty public repository under that name on GitHub (no README, licence or `.gitignore`).
2. In this working copy, replace the placeholder slugs and check the result (details under [Repository slug](#repository-slug)):

   ```bash
   node scripts/set-repo.mjs owner/repo
   npm run check
   ```

3. In `CHANGELOG.md`, fold everything into the one `## [1.0.0]` section: move the `[Unreleased]` entries and the `0.x` sections into it (they are pre-releases nobody installs as such), leave `## [Unreleased]` empty, replace `Unreleased` in the `## [1.0.0] - Unreleased` heading with the day you will push the tag (`YYYY-MM-DD`), and drop any `0.x` compare links at the bottom (the new repository has no `0.x` tags). Do not run `npm version`: `package.json` is already 1.0.0.
4. Before the first push, add the repository secrets on the new repository (Settings → Secrets and variables):
   - `PRIVACY_DENY`, with the same value as in this repository, under both **Actions** and **Dependabot**: the check fails without it (so the first push publishes no image), and Dependabot pull requests read only Dependabot secrets.
   - Optionally, for the demo deployment, the `DEMO_SSH_*` secrets (at least `DEMO_SSH_HOST`, `DEMO_SSH_USER`, `DEMO_SSH_KEY` and `DEMO_SSH_KNOWN_HOSTS`, see [Updating from GitHub](deploy-docker.md#updating-from-github-optional)); without `DEMO_SSH_HOST` the demo job does nothing.
   - If the image name stays the same (`ghcr.io/<owner>/<repo>` already exists, published from this repository), the new repository cannot push to that package until it is allowed: open the package on the profile's **Packages** tab → Package settings → Manage Actions access → Add repository, and give the new repository the **Write** role.
5. Publish the working tree as the first commit of the new repository, from an orphan branch (it starts with no history and keeps your files):

   ```bash
   git checkout --orphan public-release
   git add -A
   git commit -m "Monido 1.0.0"
   git remote add public git@github.com:owner/repo.git
   git push public public-release:master
   ```

   Run `git log --oneline public-release` before the push: it must show exactly one commit. Use the `public` remote for every later push to the published repository.
6. The push to `master` starts the `docker` workflow. When it has published `ghcr.io/<owner>/<repo>:edge`, open the package on the profile's **Packages** tab → Package settings → Change visibility → Public (a new GHCR package is private).
7. Tag the same commit and push the tag, which promotes its image to `1.0.0` and `latest` once that run is green (the tag's run waits for it):

   ```bash
   git tag -a v1.0.0 -m "v1.0.0"
   git push public v1.0.0
   ```

   The `release` job of that run then creates the GitHub release from the tag (see [Cutting a later release](#cutting-a-later-release), step 5).
8. In any existing deployment, replace the `image:` line of its compose file with the new name and run `docker compose pull && docker compose up -d`.
9. On the new repository: paste the description and topics ([Description and topics](#description-and-topics)), upload the social preview ([Social preview](#social-preview)) and enable private vulnerability reporting ([Private vulnerability reporting](#private-vulnerability-reporting)).

## Repository slug

The README badges and links, `CHANGELOG.md`, `package.json`, the issue-form contact link and these docs carry a placeholder slug, and `docker-compose.yml` keeps the image the project was first published under, so existing installations keep pulling until the rename. Once the final `owner/repo` is chosen:

```bash
node scripts/set-repo.mjs owner/repo
```

The script replaces both slugs in `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `package.json`, `docker-compose.yml`, `deploy/demo/docker-compose.demo.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `src/pages/settings/BackupView.tsx` (the link to the restore guide), `src/lib/imageRepo.ts` (the update check) and `docs/*.md`, writes the image in lowercase (`ghcr.io/owner/repo`, as GHCR requires) and prints every file it changed. It refuses anything that is not `owner/repo`. It is one-shot: once the slugs are replaced, a second run finds nothing and says so, so check the name before you run it (a mistake is fixed with `git checkout` of those files and a new run). Review `git diff`, run `npm run check` and commit.

The workflows need no change: they use `${{ github.repository }}`, so after a rename the next push publishes the image under the new name. An installation made before the rename keeps the old `image:` line; replace it with the new one and run `docker compose pull && docker compose up -d`.

## Description and topics

On the repository page, the gear next to **About**. The description is the README pitch, word for word (under 120 characters):

```text
Track your net worth and cash flow — on your own or as a family. Self-hosted, entered by hand, no bank connections.
```

Topics:

```text
self-hosted personal-finance family net-worth cash-flow dashboard react hono sqlite docker i18n
```

There is no `budget` topic on purpose: the app has spending categories but no budgets or limits, so it would bring the wrong visitors.

## Social preview

Settings → General → Social preview → Edit → Upload an image: `docs/assets/social-preview.png` (1280×640). After a change to the app or the pitch, regenerate it with `npm run screenshots` (see [Development](development.md#screenshots-and-the-social-preview)), commit the PNGs and upload it again.

## Cutting a later release

For releases after 1.0.0; the first one follows [First public release](#first-public-release-v100).

Until 1.0.0, pre-releases are `v0.x.y` tags pushed on a `master` commit (step 4 below) with no `CHANGELOG.md` section and no `npm version`: the notes come from the commit subjects since the previous tag, and the `release` workflow marks a `v0.*` release as a pre-release.

1. In `CHANGELOG.md`, move the `[Unreleased]` entries under a new `## [x.y.z] - YYYY-MM-DD` heading and update the compare links at the bottom.
2. `npm version x.y.z --no-git-tag-version` sets the version in `package.json` and `package-lock.json`.
3. `npm run check`, commit (`chore: release x.y.z`) and push to `master`.
4. Tag the pushed commit and push the tag; there is no need to wait for the `master` run first:

   ```bash
   git tag -a vx.y.z -m "vx.y.z"
   git push origin vx.y.z
   ```

   A push to `master` runs the check and the container smoke test, then publishes `ghcr.io/<owner>/<repo>:edge` and `:sha-<7-char commit>` for amd64 and arm64, with a version like `x.y.z-3-gabc1234`. The tag's run does not rebuild and does not check the code again: its `master-build` job waits for the `master` run of the tagged commit (a green run is the proof the commit passed the check and the smoke test), then `promote` takes `sha-<commit>` and publishes it as `x.y.z` and `latest` with the version set to `x.y.z` (`.github/workflows/docker.yml`; `.github/promote/Dockerfile`), and the `release` and `demo` jobs follow in the same run. The tags operators see are in [Image tags](deploy-docker.md#image-tags).

   Only a plain `vX.Y.Z` tag is promoted: any other tag the trigger admits (`v1.4.0-rc.1`, `v1.2.3.4`) fails the run before anything is published. If the `master` run of the tagged commit fails or is cancelled (GitHub cancels a pending run in the same concurrency group when a newer push comes), `master-build` fails at once with that conclusion and nothing is published: re-run the `master` run (or fix `master` and tag a green commit), then open the tag's `docker` run and click **Re-run failed jobs**; it promotes, publishes the release and deploys the demo. A commit `master` never built (one in the middle of a multi-commit push) fails after about five minutes with "master never built …": tag the head of a push instead.
5. The GitHub release is created by the `release` job of the same workflow once the tag's image is published (`.github/workflows/release.yml`, text from `scripts/release-notes.mjs`): the `## [x.y.z]` section of `CHANGELOG.md`, else the commit subjects since the previous tag grouped by type; "How to update" and the compare link are always added, and `0.x` versions are marked as pre-releases. To change the text later, edit the `## [x.y.z]` section of `CHANGELOG.md`, push, and run the `release` workflow by hand (Actions → release → Run workflow, tag `vx.y.z`): an existing release gets its notes replaced. The same manual run publishes a release for an older tag that has none.

A new GHCR package is private. The first time an image is published under a name (the first release, or after a rename), open the package on the profile's **Packages** tab → Package settings → Change visibility → Public, so `docker compose pull` works without a login.

## Moving the demo to a new domain

Repository links alone do not move the running demo: DNS, Caddy and the host's `APP_URL` change separately, and GitHub Actions does not copy the host configuration. Below, `old-demo.example.com` is the current address and `demo.example.com` the new one.

1. Create DNS-only A/AAAA records for the new name pointing to the demo host (AAAA only if the host serves IPv6). Keep the old name's DNS.
2. Add a Caddy site for the new name with `reverse_proxy 127.0.0.1:8080` next to the old one, validate and reload Caddy ([HTTPS and the domain](deploy-docker.md#https-and-the-domain)), and check HTTPS on the new name.
3. Set `APP_URL=https://demo.example.com` in the host's demo `.env` and run `./demo-update.sh` with the installed release tag, so the app is recreated with the new environment; keep the demo volume. Visitors sign in again: cookies belong to the old name.
4. Check `https://demo.example.com/api/health` returns `{"ok":true}`, a demo sign-in and one edit. Only then replace the old site's block with a redirect and validate and reload Caddy again:

   ```caddyfile
   old-demo.example.com {
       redir https://demo.example.com{uri} 308
   }
   ```

   Keep the old name's DNS and HTTPS for bookmarks. If a check fails, keep the old block, restore the previous `APP_URL` and rerun the update script with the same tag.
5. Replace the demo address in the repository's links.

## Dependency overrides

`package.json` pins `minimatch` to `^11.0.1` through `overrides`: the lint tooling (`eslint`, `@typescript-eslint/typescript-estree`) still asks for `^10`, which carries a moderate Dependabot alert (denial of service through glob amplification, fixed in 11.0.1). It touches development tools only, nothing in the shipped bundle. Drop the override once those packages depend on `minimatch` 11 or later (`npm ls minimatch` shows who asks for what), then run `npm install` and `npm run check`.

## Private vulnerability reporting

[Settings → Code security](https://github.com/stanislav-petryashov/monido/settings/security_analysis) → Private vulnerability reporting → Enable. `SECURITY.md` and the "Report a security vulnerability" link of the issue chooser send reporters to it; until it is on, the **Report a vulnerability** button does not appear.
