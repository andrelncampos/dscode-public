#!/usr/bin/env bash
# sync-public-readme.sh
# Transforms the private README for public consumption and pushes to dscode-public.
set -euo pipefail

PUBLIC_REPO="${PUBLIC_REPO:-andrelncampos/dscode-public}"
GH_TOKEN="${PUBLIC_REPO_PAT:?PUBLIC_REPO_PAT is required}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "=== Cloning public repo ==="
git clone "https://x-access-token:${GH_TOKEN}@github.com/${PUBLIC_REPO}.git" "$WORKDIR/public"

echo "=== Transforming README.md ==="
cp README.md "$WORKDIR/public/README.md"

# Fix repo URLs: dscode -> dscode-public (but not dscode-public -> dscode-public-public)
sed -i 's|github.com/andrelncampos/dscode/releases|github.com/andrelncampos/dscode-public/releases|g' "$WORKDIR/public/README.md"
sed -i 's|github.com/andrelncampos/dscode/issues|github.com/andrelncampos/dscode-public/issues|g' "$WORKDIR/public/README.md"
sed -i 's|github.com/andrelncampos/dscode/blob/main/LICENSE|github.com/andrelncampos/dscode-public/blob/master/LICENSE|g' "$WORKDIR/public/README.md"
sed -i 's|github.com/andrelncampos/dscode|github.com/andrelncampos/dscode-public|g' "$WORKDIR/public/README.md"

# Fix relative links that point outside
sed -i 's|(../../LICENSE)|(LICENSE)|g' "$WORKDIR/public/README.md"
sed -i 's|(../../NOTICE)|(CHANGELOG.md)|g' "$WORKDIR/public/README.md"
sed -i 's|(../../SECURITY.md)|(SECURITY.md)|g' "$WORKDIR/public/README.md"
sed -i 's|(../../CONTRIBUTING.md)|(CHANGELOG.md)|g' "$WORKDIR/public/README.md"

# Remove Contributing section
sed -i '/^## Contribuição/,/^---$/d' "$WORKDIR/public/README.md"

echo "=== Copying i18n READMEs ==="
mkdir -p "$WORKDIR/public/docs/i18n"
for f in docs/i18n/README.*.md; do
  cp "$f" "$WORKDIR/public/docs/i18n/$(basename "$f")"

  # Fix URLs in translated files
  sed -i 's|github.com/andrelncampos/dscode/releases|github.com/andrelncampos/dscode-public/releases|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|github.com/andrelncampos/dscode/issues|github.com/andrelncampos/dscode-public/issues|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|github.com/andrelncampos/dscode/blob/main/LICENSE|github.com/andrelncampos/dscode-public/blob/master/LICENSE|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|github.com/andrelncampos/dscode|github.com/andrelncampos/dscode-public|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|(../../LICENSE)|(../LICENSE)|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|(../../NOTICE)|(../CHANGELOG.md)|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|(../../SECURITY.md)|(../SECURITY.md)|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
  sed -i 's|(../../CONTRIBUTING.md)|(../CHANGELOG.md)|g' "$WORKDIR/public/docs/i18n/$(basename "$f")"
done

echo "=== Checking for changes ==="
cd "$WORKDIR/public"
if git diff --quiet && git diff --staged --quiet; then
  echo "No changes — public repo is already up to date."
  exit 0
fi

echo "=== Committing and pushing ==="
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add .
git commit -m "docs: sync README and i18n from private repo"
git push origin master

echo "=== Done ==="
