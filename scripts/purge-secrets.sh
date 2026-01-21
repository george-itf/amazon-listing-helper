#!/bin/bash
# Script to purge sensitive files from git history
# WARNING: This rewrites git history - coordinate with team before running
# All credentials should be rotated AFTER this script runs

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Secret Purge Script ==="
echo "Repository: $REPO_ROOT"
echo ""

# Files to remove from history
FILES_TO_PURGE=(
    "main/data/credentials.json"
    "main/data/keepa.json"
    "main/data/listings.json"
    "main/data/alerts.json"
    "main/data/scores.json"
    "main/data/tasks.json"
    "main/data/pending-changes.json"
    "main/data/templates.json"
)

# Check if git-filter-repo is available
if ! command -v git-filter-repo &> /dev/null; then
    echo "ERROR: git-filter-repo is not installed"
    echo "Install with: pip3 install git-filter-repo"
    exit 1
fi

# Dry run mode by default
DRY_RUN=true
if [[ "$1" == "--execute" ]]; then
    DRY_RUN=false
    echo "WARNING: Running in EXECUTE mode - this will rewrite git history!"
    echo "Press Ctrl+C within 5 seconds to abort..."
    sleep 5
fi

if $DRY_RUN; then
    echo "Running in DRY RUN mode (use --execute to apply changes)"
    echo ""
    echo "Files that would be removed from history:"
    for file in "${FILES_TO_PURGE[@]}"; do
        if git log --all --full-history -- "$file" | head -1 | grep -q commit; then
            echo "  - $file (found in history)"
        else
            echo "  - $file (not found in history)"
        fi
    done
    echo ""
    echo "To execute the purge, run:"
    echo "  $0 --execute"
    exit 0
fi

# Create backup branch
BACKUP_BRANCH="backup-before-purge-$(date +%Y%m%d-%H%M%S)"
echo "Creating backup branch: $BACKUP_BRANCH"
git branch "$BACKUP_BRANCH" 2>/dev/null || true

# Build the path filter arguments
PATHS_ARGS=""
for file in "${FILES_TO_PURGE[@]}"; do
    PATHS_ARGS="$PATHS_ARGS --path $file"
done

echo ""
echo "Purging files from git history..."
echo "This may take a while depending on repository size."
echo ""

# Run git-filter-repo to remove the files
git filter-repo --invert-paths $PATHS_ARGS --force

echo ""
echo "=== Purge Complete ==="
echo ""
echo "IMPORTANT NEXT STEPS:"
echo "1. Verify the files are removed: git log --all --full-history -- main/data/credentials.json"
echo "2. Force push to remote: git push origin --force --all"
echo "3. Force push tags: git push origin --force --tags"
echo "4. ROTATE ALL CREDENTIALS IMMEDIATELY:"
echo "   - Amazon SP-API: Create new LWA credentials"
echo "   - Keepa API: Generate new API key"
echo "5. Update environment variables in Railway/deployment"
echo "6. Notify all team members to re-clone the repository"
echo ""
echo "Backup branch created: $BACKUP_BRANCH"
