#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || "$2" != "--confirm" ]]; then
  printf '사용법: %s <백업 디렉터리> --confirm\n' "$0" >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="$(cd "$1" && pwd)"
database_file="$backup_dir/database.sql"
runtime_file="$backup_dir/runtime.tar.gz"

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"; return; fi
  if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; return; fi
  printf 'Docker Compose를 찾을 수 없습니다. Docker Desktop 또는 Compose 플러그인을 확인해 주세요.\n' >&2
  return 127
}

[[ -f "$database_file" && -f "$runtime_file" ]] || { printf '백업 파일을 찾을 수 없습니다.\n' >&2; exit 2; }
if [[ -f "$backup_dir/SHA256SUMS" ]]; then (cd "$backup_dir" && shasum -a 256 -c SHA256SUMS); fi
cd "$project_root"

compose stop app
compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u "$MYSQL_USER" "$MYSQL_DATABASE"' < "$database_file"
docker run --rm -v studyspace-runtime:/target -v "$backup_dir:/backup:ro" alpine:3.22 sh -c 'find /target -mindepth 1 -delete && tar -C /target -xzf /backup/runtime.tar.gz'
compose up -d app

printf '복원 완료: %s\n' "$backup_dir"
