#!/usr/bin/env bash
# Forced command for the deploy key the demo-deploy workflow uses (docs/deploy-docker.md, "Updating from GitHub"):
#   restrict,command="/full/path/to/demo-ci-deploy.sh" ssh-ed25519 AAAA… demo-deploy
# in the host user's ~/.ssh/authorized_keys. Whatever the workflow asks for, the key can only run demo-update.sh,
# next to this script, with the release tag found in the requested command; the command itself is never run.
set -u

tag=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-}" | grep -Eo "(^|[^0-9A-Za-z.])v[0-9]+\.[0-9]+\.[0-9]+(['\" ]|$)" | grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' | tail -n 1)
if [ -z "$tag" ]; then
  echo "demo-ci-deploy: the command names no release tag (vX.Y.Z)" >&2
  exit 2
fi
cd "$(dirname "$0")" || exit 1
exec ./demo-update.sh "$tag"
