#!/bin/bash
# Install pre-commit hooks for secret scanning
# Run this once after cloning the repository

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Installing Pre-commit Hooks ==="

# Create .git/hooks directory if it doesn't exist
mkdir -p .git/hooks

# Create pre-commit hook
cat > .git/hooks/pre-commit << 'HOOK_EOF'
#!/bin/bash
# Pre-commit hook to scan for secrets

echo "Running secret scan..."

# Patterns that indicate potential secrets
PATTERNS=(
    # Amazon SP-API
    'amzn1\.application-oa2-client\.[a-f0-9]+'
    'amzn1\.oa2-cs\.v1\.[a-f0-9]+'
    'Atzr\|[A-Za-z0-9_-]+'
    # Generic API keys
    'api[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9]{20,}'
    'api[_-]?secret["\s]*[:=]["\s]*[a-zA-Z0-9]{20,}'
    # AWS
    'AKIA[0-9A-Z]{16}'
    'aws_secret_access_key'
    # Private keys
    'BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY'
    # Generic secrets
    'password["\s]*[:=]["\s]*[^${\n]{8,}'
    'secret["\s]*[:=]["\s]*[a-zA-Z0-9]{16,}'
)

# Files to check (staged files only)
FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$FILES" ]; then
    exit 0
fi

FOUND_SECRETS=0

for file in $FILES; do
    # Skip binary files, node_modules, and specific safe files
    if [[ "$file" =~ \.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$ ]]; then
        continue
    fi
    if [[ "$file" =~ node_modules/ ]]; then
        continue
    fi
    if [[ "$file" =~ package-lock\.json$ ]]; then
        continue
    fi
    if [[ "$file" =~ \.env\.example$ ]]; then
        continue
    fi

    # Check if file exists
    if [ ! -f "$file" ]; then
        continue
    fi

    for pattern in "${PATTERNS[@]}"; do
        if grep -qiE "$pattern" "$file" 2>/dev/null; then
            echo "ERROR: Potential secret found in $file"
            echo "Pattern: $pattern"
            grep -niE "$pattern" "$file" | head -3
            echo ""
            FOUND_SECRETS=1
        fi
    done
done

if [ $FOUND_SECRETS -eq 1 ]; then
    echo "========================================"
    echo "COMMIT BLOCKED: Potential secrets found!"
    echo "========================================"
    echo ""
    echo "If this is a false positive, you can:"
    echo "1. Add the file to .gitignore"
    echo "2. Use 'git commit --no-verify' (NOT recommended)"
    echo "3. Update the pre-commit hook patterns"
    echo ""
    exit 1
fi

echo "Secret scan passed."
exit 0
HOOK_EOF

chmod +x .git/hooks/pre-commit

echo "Pre-commit hook installed successfully!"
echo ""
echo "The hook will scan for:"
echo "  - Amazon SP-API credentials (client IDs, secrets, refresh tokens)"
echo "  - AWS access keys"
echo "  - Private keys"
echo "  - Generic API keys and secrets"
echo ""
echo "To bypass (NOT recommended): git commit --no-verify"
