#!/bin/bash
#
# Database Backup Script for Amazon Listing Helper
#
# Backs up critical tables and keeps 7 days of history.
# Run manually or via cron.
#
# Usage:
#   ./scripts/backup-database.sh           # Full backup
#   ./scripts/backup-database.sh --boms    # BOM-related tables only
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../backups"
CONTAINER_NAME="alh-postgres"
DB_USER="alh_user"
DB_NAME="amazon_listing_helper"
RETENTION_DAYS=7

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE_ONLY=$(date +%Y%m%d)

# Determine backup type
if [ "$1" == "--boms" ]; then
    BACKUP_TYPE="boms"
    TABLES="-t boms -t bom_lines -t components -t suppliers"
    echo "[Backup] Creating BOM-only backup..."
else
    BACKUP_TYPE="full"
    TABLES=""
    echo "[Backup] Creating full database backup..."
fi

BACKUP_FILE="${BACKUP_DIR}/${BACKUP_TYPE}_backup_${TIMESTAMP}.sql"
BACKUP_FILE_GZ="${BACKUP_FILE}.gz"

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[Backup] ERROR: Container ${CONTAINER_NAME} is not running"
    exit 1
fi

# Create backup
echo "[Backup] Dumping database..."
if [ "$BACKUP_TYPE" == "full" ]; then
    docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"
else
    docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" $TABLES > "$BACKUP_FILE"
fi

# Compress backup
echo "[Backup] Compressing..."
gzip "$BACKUP_FILE"

# Get file size
SIZE=$(du -h "$BACKUP_FILE_GZ" | cut -f1)
echo "[Backup] Created: $BACKUP_FILE_GZ ($SIZE)"

# Clean up old backups (keep last 7 days)
echo "[Backup] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

# List current backups
echo ""
echo "[Backup] Current backups:"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -10 || echo "  (none)"

echo ""
echo "[Backup] Done! Backup saved to: $BACKUP_FILE_GZ"
