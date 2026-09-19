#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill in local values." >&2
  exit 1
fi

# Export values from the untracked local file for Spring Boot.
set -a
# shellcheck disable=SC1091
source ./.env
set +a

if command -v gradle >/dev/null 2>&1; then
  exec gradle bootRun --no-daemon
fi

echo "Gradle is not installed. Install Gradle 9+ or add a Gradle wrapper." >&2
exit 1
