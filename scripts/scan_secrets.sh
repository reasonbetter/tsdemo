#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Scanning repo for obvious secrets..."

# Patterns to scan for (extend as needed)
PATTERNS=(
  'sk-[A-Za-z0-9_-]{10,}'
  'OPENAI_API_KEY\s*=\s*[^\s]'
  'DATABASE_URL\s*=\s*postgres(ql)?://'
  'postgres(ql)?://[^\s]*@'
)

RC=0
for pat in "${PATTERNS[@]}"; do
  if rg -n --hidden -S -g '!node_modules/**' -g '!.git/**' -g '!.next/**' -e "$pat" "$ROOT_DIR"; then
    RC=1
  fi
done

if [ $RC -ne 0 ]; then
  echo "One or more suspicious matches found. Review output above." >&2
else
  echo "No suspicious matches found for basic patterns."
fi

exit $RC

