// The published repository's slug: one place for the registry check (server) and the package link (client).
// scripts/set-repo.mjs lists this file, so a fork rewrites it.
const REPO_SLUG = 'stanislav-petryashov/monido'

/** The image name on ghcr.io: always lowercase. */
export const IMAGE_REPO = REPO_SLUG.toLowerCase()

/** The image's package page on GitHub. */
export const PACKAGE_URL = `https://github.com/users/${IMAGE_REPO.split('/')[0]}/packages/container/package/${IMAGE_REPO.split('/')[1]}`
