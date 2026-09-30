#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_root="${STUDYSPACE_BACKUP_DIR:-$project_root/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_root/$timestamp"

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"; return; fi
  if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; return; fi
  printf 'Docker Compose를 찾을 수 없습니다. Docker Desktop 또는 Compose 플러그인을 확인해 주세요.\n' >&2
  return 127
}

umask 077
mkdir -p "$destination"
cd "$project_root"

compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --single-transaction --routines --triggers -u "$MYSQL_USER" "$MYSQL_DATABASE"' > "$destination/database.sql"
docker run --rm -v studyspace-runtime:/source:ro -v "$destination:/backup" alpine:3.22 tar -C /source -czf /backup/runtime.tar.gz .
[[ -s "$destination/database.sql" && -s "$destination/runtime.tar.gz" ]] || { printf '백업 파일을 완성하지 못했습니다.\n' >&2; exit 1; }
(cd "$destination" && shasum -a 256 database.sql runtime.tar.gz > SHA256SUMS)

printf '백업 완료: %s\n' "$destination"
