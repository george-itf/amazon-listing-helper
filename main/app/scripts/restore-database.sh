#!/bin/bash
#
# Database Restore Script for Amazon Listing Helper
#
# Restores from a backup file.
#
# Usage:
#   ./scripts/restore-database.sh backups/full_backup_20240115_120000.sql.gz
#   ./scripts/restore-database.sh backups/boms_backup_20240115_120000.sql.gz
#

set -e

CONTAINER_NAME="alh-postgres"
DB_USER="alh_user"
DB_NAME="amazon_listing_helper"

if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh "$(dirname "$0")/../backups"/*.sql.gz 2>/dev/null || echo "  (none found)"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "[Restore] ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[Restore] ERROR: Container ${CONTAINER_NAME} is not running"
    exit 1
fi

echo "[Restore] WARNING: This will overwrite existing data!"
echo "[Restore] Backup file: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to restore? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "[Restore] Aborted."
    exit 0
fi

echo "[Restore] Restoring from $BACKUP_FILE..."

# Decompress and restore
if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" "$DB_NAME"
else
    cat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" "$DB_NAME"
fi

echo "[Restore] Done! Database restored from: $BACKUP_FILE"
