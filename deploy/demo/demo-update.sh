#!/usr/bin/env bash
# Updates the public demo without cutting visitors off: ./demo-update.sh v1.4.0
# Pull before draining; Compose waits for health, then the drain flag is cleared even if startup failed.
# Run beside docker-compose.demo.yml and .env; requires Docker Compose 2.24+.
# Overrides: DEMO_COMPOSE_FILE, DEMO_DATA_DIR, DEMO_POLL_SECONDS (15), DEMO_WAIT_SECONDS (1200), DEMO_HEALTH_SECONDS (180).
# Exit: 0 success, 1 update failed, 2 usage, 3 pull failed (the workflow retries only this).
set -u

tag="${1:-}"
if [ -z "$tag" ]; then
  echo "Usage: $0 <tag>   (for example: $0 v1.4.0)" >&2
  exit 2
fi
# the image is published as 1.4.0, the git tag is v1.4.0
DEMO_TAG="${tag#v}"
export DEMO_TAG

compose_file="${DEMO_COMPOSE_FILE:-docker-compose.demo.yml}"
data_dir="${DEMO_DATA_DIR:-/data}"
poll="${DEMO_POLL_SECONDS:-15}"
limit="${DEMO_WAIT_SECONDS:-1200}"
health_limit="${DEMO_HEALTH_SECONDS:-180}"
# Compose treats zero as unlimited; reject it before entering maintenance mode.
if ! [[ "$health_limit" =~ ^[1-9][0-9]*$ ]]; then
  echo "DEMO_HEALTH_SECONDS must be a positive integer" >&2
  exit 2
fi

dc() { docker compose -f "$compose_file" "$@"; }

echo "Pulling $DEMO_TAG (the running demo is untouched)"
if ! dc pull demo; then
  echo "Pull failed: the demo keeps running on its current image" >&2
  exit 3
fi

echo "Draining: new sign-ins are refused, live sessions run until they expire"
if ! dc exec -T demo touch "$data_dir/drain"; then
  echo "Warning: could not set the drain flag (is the demo running?)" >&2
fi

start=$(date +%s)
while true; do
  if ! status=$(dc exec -T demo cat "$data_dir/demo-status.json"); then
    echo "Warning: cannot read the demo status; assuming nobody is live" >&2
    break
  fi
  # the server rewrites the file once a tick (up to 60 s after the flag appears): a "live":0 counts only from a
  # status written while draining, otherwise it is the old file and a visitor may have signed in since
  if printf '%s' "$status" | grep -Eq '"live"[[:space:]]*:[[:space:]]*0([^0-9.]|$)' \
    && printf '%s' "$status" | grep -Eq '"draining"[[:space:]]*:[[:space:]]*true'; then
    break
  fi
  if [ $(( $(date +%s) - start )) -ge "$limit" ]; then
    echo "Warning: sessions are still live after ${limit}s; updating anyway" >&2
    break
  fi
  echo "Waiting for live sessions to end: $status"
  sleep "$poll"
done

echo "Recreating the demo on $DEMO_TAG"
clear_flag() {
  # /data is a named volume: the flag survives the recreate, so it must go or sign-ins stay refused
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    dc exec -T demo rm -f "$data_dir/drain" && return 0
    sleep "$poll"
  done
  return 1
}
result=0
# --wait uses the image's healthcheck; Caddy is a separate host service and is never restarted here.
dc up -d --no-deps --wait --wait-timeout "$health_limit" demo || result=1
if ! clear_flag; then
  echo "Could not clear $data_dir/drain: sign-ins stay refused; remove it by hand" >&2
  exit 1
fi
if [ "$result" -ne 0 ]; then
  echo "Demo startup or health check failed; drain flag cleared. Check: docker compose -f $compose_file logs demo" >&2
  exit 1
fi
echo "Sign-ins may stay refused for up to a minute, until the server's next tick notices the flag is gone"
echo "Done: demo is on $DEMO_TAG"
