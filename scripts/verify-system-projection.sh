#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_sdk_environment

repository=$(release_repository)
build=$(prismpm --json build --locked --release B --tag "$repository:b-candidate")
build_id=$(json_field build_id <<<"$build")
build_root=".prism/build/$build_id"
coverage="$build_root/projections/capability-coverage.json"
test -f "$coverage" || die 'generated public-feature coverage is absent'
node scripts/verify-system-projections.mjs "$build_root" B
node scripts/verify-coverage.mjs "$coverage"
cmp "$coverage" artifacts/feature-coverage.json
grep -Eq '^[0-9a-f]{64}  artifacts/feature-coverage\.json$' SHA256SUMS ||
  die 'SHA256SUMS does not bind the generated coverage artifact'
sha256sum --check SHA256SUMS
printf 'Calculator system projection %s is exact\n' "$build_id"
