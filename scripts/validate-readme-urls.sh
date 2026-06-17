#!/usr/bin/env bash
# validate-readme-urls.sh — Ensure all GitHub URLs in READMEs point to the correct repo.
# Prevents typos like dscode-public-public and cross-repo URL leakage.
set -euo pipefail

# --- Detect repo name from git remote ---
REMOTE_URL=$(git remote get-url origin 2>/dev/null)
REPO_NAME=$(echo "$REMOTE_URL" | sed 's|.*/||; s|\.git$||')
if [ -z "$REPO_NAME" ]; then
  echo "::error::Could not detect repo name from git remote"
  exit 1
fi
echo "Validating README URLs for repo: $REPO_NAME"

# --- Patterns that must NOT appear (typos) ---
TYPO_PATTERNS=(
  "dscode-public-public"
  "dscode-publicpublic"
)

# --- Find all README files ---
README_FILES=$(find . -name "README*.md" -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null)

if [ -z "$README_FILES" ]; then
  echo "No README files found - nothing to validate"
  exit 0
fi

ERRORS=0

# --- Check 1: Typo patterns (absolute errors, always wrong) ---
for pattern in "${TYPO_PATTERNS[@]}"; do
  while IFS=: read -r file line content; do
    echo "TYPO '$pattern' in $file:$line -> $content"
    ERRORS=$((ERRORS + 1))
  done < <(grep -n "$pattern" $README_FILES 2>/dev/null || true)
done

# --- Check 2: Cross-repo URLs ---
# Extract repo name from https://github.com/andrelncampos/<repo>/... URLs
while IFS=: read -r file line content; do
  # Extract the repo portion from https:// URL only (not link display text)
  url_repo=$(echo "$content" | grep -o 'https://github\.com/andrelncampos/[^/)]*' | sed 's|https://github\.com/andrelncampos/||' | head -1)
  if [ -n "$url_repo" ] && [ "$url_repo" != "$REPO_NAME" ]; then
    echo "WRONG REPO in $file:$line -> expected '$REPO_NAME', found '$url_repo'"
    echo "  $content"
    ERRORS=$((ERRORS + 1))
  fi
done < <(grep -n "https://github\.com/andrelncampos/" $README_FILES 2>/dev/null || true)

# --- Result ---
if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "$ERRORS URL validation error(s) found"
  echo "  All github.com/andrelncampos URLs must point to: $REPO_NAME"
  exit 1
fi

echo "All README URLs point to correct repo: $REPO_NAME"
