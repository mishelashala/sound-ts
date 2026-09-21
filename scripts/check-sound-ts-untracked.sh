#!/usr/bin/env bash
# Fail if any path under .sound-ts/ is tracked by git.
# Run from the repository root.
set -euo pipefail

tracked="$(git ls-files -- .sound-ts)"
if [[ -n "${tracked}" ]]; then
  echo "error: paths under .sound-ts/ are tracked by git:" >&2
  printf '%s\n' "${tracked}" >&2
  exit 1
fi
