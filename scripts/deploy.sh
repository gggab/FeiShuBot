#!/usr/bin/env bash
# Build and (re)start the FeiShuBot container. See docs/deployment.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

required_files=(
  .env
  projects.json
  usermap.json
  bugfix-allowlist.json
  bugfix-allowed-departments.json
  code-read-allowlist.json
  code-read-allowed-chats.json
)
missing=()
for f in "${required_files[@]}"; do
  [ -f "$f" ] || missing+=("$f")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "[deploy] missing required config files (see docs/deployment.md §5):" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "[deploy] copy the matching *.example.json (or .env.example) and fill it in first." >&2
  exit 1
fi

echo "[deploy] building image..."
docker compose build

echo "[deploy] starting service..."
docker compose up -d

echo "[deploy] recent logs:"
docker compose logs --tail=50 feishubot
