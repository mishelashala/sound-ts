#!/usr/bin/env bash
# Fail if any path under .superset/ is tracked by git.
# Run from the repository root.
set -euo pipefail

tracked="$(git ls-files -- .superset)"
if [[ -n "${tracked}" ]]; then
  echo "error: paths under .superset/ are tracked by git:" >&2
  printf '%s\n' "${tracked}" >&2
  exit 1
fi
