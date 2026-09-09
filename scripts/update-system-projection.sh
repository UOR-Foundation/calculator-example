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

stage=$(mktemp -d "$project_root/.prism/system-projection.XXXXXX")
success=false
mutation_started=false
cleanup() {
  if test "$success" != true && test "$mutation_started" = true; then
    if test -f "$stage/feature-coverage.previous"; then
      install -m 0644 "$stage/feature-coverage.previous" artifacts/feature-coverage.json
    else
      rm -f artifacts/feature-coverage.json
    fi
    install -m 0644 "$stage/SHA256SUMS.previous" SHA256SUMS
  fi
  rm -rf "$stage"
}
trap cleanup EXIT

cp SHA256SUMS "$stage/SHA256SUMS.previous"
if test -f artifacts/feature-coverage.json; then
  cp artifacts/feature-coverage.json "$stage/feature-coverage.previous"
fi
cp "$coverage" "$stage/feature-coverage.json"
mutation_started=true
install -m 0644 "$stage/feature-coverage.json" artifacts/feature-coverage.json

sha256sum \
  artifacts/Calculator.holo \
  artifacts/application-acceptance.json \
  artifacts/build-manifest.json \
  artifacts/calculator-baseline.json \
  artifacts/feature-coverage.json \
  artifacts/historical-plan-05sep26.md \
  artifacts/historical-release-candidate.json \
  artifacts/model.prism.json \
  artifacts/verification-manifest.json \
  artifacts/view-manifest.json \
  public/app.css \
  public/app.js \
  public/index.html \
  public/prism_calculator.js \
  public/prism_calculator_bg.wasm \
  public/provenance.json >"$stage/SHA256SUMS"
install -m 0644 "$stage/SHA256SUMS" SHA256SUMS

record_json system-projection "$(node - "$build_id" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const buildId = process.argv[2];
const bytes = fs.readFileSync('artifacts/feature-coverage.json');
process.stdout.write(JSON.stringify({
  artifact: {
    path: 'artifacts/feature-coverage.json',
    sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
  },
  build_id: buildId,
  release: 'B',
  schema: 'calculator/system-projection/1',
  status: 'generated',
}));
NODE
)"
success=true
printf 'generated Calculator system projection %s\n' "$build_id"
