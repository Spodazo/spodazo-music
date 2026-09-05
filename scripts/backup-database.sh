#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${BACKUP_DIR:-$HOME/backups/spodazo-music}"
mkdir -p "$OUT_DIR"

if [[ -n "${DATABASE_URL:-}" ]]; then
  dump="$OUT_DIR/spodazo-music-$STAMP.dump"
  pg_dump --format=custom --file="$dump" "$DATABASE_URL"
  echo "Wrote $dump"
else
  src="${MUSIC_DATA_DIR:-$ROOT/.music-data}"
  archive="$OUT_DIR/spodazo-music-data-$STAMP.tar.gz"
  tar -czf "$archive" -C "$(dirname "$src")" "$(basename "$src")"
  echo "Wrote $archive"
fi
