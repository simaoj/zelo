#!/usr/bin/env bash
# Full replica-set dump with oplog: run from any directory, schedule with cron/systemd.
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
mkdir -p backups
archive="backups/zelo-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
partial="$(mktemp backups/.dump.XXXXXX)"
trap 'rm -f "$partial"' EXIT
docker compose --env-file .env.production -f compose.production.yml exec -T mongo \
  sh -ec 'exec mongodump --host 127.0.0.1 --username admin --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip --oplog' > "$partial"
mv "$partial" "$archive"
printf 'Backup criado: %s\n' "$archive"
