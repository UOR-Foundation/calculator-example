#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
mode=${1:-}
case "$mode" in
  '') require_sdk ;;
  --baseline-input)
    require_sdk_environment
    node scripts/verify-baseline.mjs --require-input-ready >/dev/null
    git diff --quiet
    git diff --cached --quiet
    test -z "$(git ls-files --others --exclude-standard)" ||
      die 'baseline input requires a clean committed source closure'
    rm -rf .prism/repository-evidence
    ;;
  *) die 'usage: scripts/verify.sh [--baseline-input]' ;;
esac

for forbidden in .gitmodules .prismpm-version vendor/PrismPM .cargo/config.toml registry; do
  test ! -e "$forbidden" || die "forbidden source/tool fallback exists: $forbidden"
done
if git ls-files -s | grep -q '^160000 '; then
  die 'a Git submodule remains in the repository'
fi
if rg -n --glob 'Cargo.toml' --glob '.cargo/config.toml' \
  '(path|git)\s*=|replace-with\s*=' .; then
  die 'Cargo contains a path, Git, or replacement source'
fi
if git ls-files '*.lean' 'lakefile.lean' | grep -q .; then
  die 'handwritten Lean is not permitted'
fi
mapfile -t source_files < <(find src -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
expected_source_files=(Calculator.lex.tex CalculatorSystem.lex.tex lib.rs)
test "${source_files[*]}" = "${expected_source_files[*]}" ||
  die 'src contains behavior outside the two model roots and package re-export'
test "$(tr -d '\r' <src/lib.rs)" = $'#![forbid(unsafe_code)]\n\npub use prism_calculator::*;' ||
  die 'the consumer crate contains handwritten Calculator behavior'
if rg -n --glob '!public/**' --glob '!artifacts/**' \
  '(?:test|describe)\.(?:skip|fixme|only)\b|\.skip\(|#\[ignore(?:\([^]]*\))?\]|@(?:ignore|skip)\b|--(?:ignore|ignored|skip)\b|continue-on-error:[[:space:]]*true' \
  .; then
  die 'a repository or acceptance test is skipped, filtered, or marked fixme/only'
fi
node scripts/test-baseline-evidence.mjs
node scripts/test-historical-baseline.mjs
node scripts/test-conformance-result.mjs
node scripts/test-coverage-contract.mjs
node scripts/test-target-policy.mjs
node scripts/test-workflow-policy.mjs
node scripts/test-acceptance-policy.mjs
node scripts/test-runtime-binding.mjs
node scripts/test-external-image-contract.mjs
node scripts/test-bootstrap-render.mjs
./scripts/test-sdk-environment.sh

prismpm template check >/dev/null
check=$(prismpm --json check)
application_first=$(prismpm --json build)
application_id=$(json_field build_id <<<"$application_first")
verification=$(prismpm --json verify)
node scripts/test-formal-model-mutations.mjs
repository=$(release_repository)
system_a=$(prismpm --json build --locked --release A --tag "$repository:a-candidate")
system_b=$(prismpm --json build --locked --release B --tag "$repository:b-candidate")
system_a_id=$(json_field build_id <<<"$system_a")
system_b_id=$(json_field build_id <<<"$system_b")
test "$system_a_id" != "$system_b_id" || die 'modeled releases A and B are not distinct'
record_json repository-check "$check"
record_json application-build "$application_first"
record_json verification "$verification"
record_json system-build-a "$system_a"
record_json system-build-b "$system_b"
printf 'CALCULATOR_RELEASE_A=%q\nCALCULATOR_RELEASE_B=%q\n' \
  "$(digest_reference "$repository" "$system_a")" \
  "$(digest_reference "$repository" "$system_b")" \
  >.prism/repository-evidence/releases.env

application_root=.prism/build/$application_id
cmp "$application_root/Calculator.holo" artifacts/Calculator.holo
cmp "$application_root/manifest.json" artifacts/build-manifest.json
cmp "$application_root/model.prism.json" artifacts/model.prism.json
cmp "$application_root/view/view-manifest.json" artifacts/view-manifest.json
for path in app.css app.js index.html prism_calculator.js prism_calculator_bg.wasm provenance.json; do
  cmp "$application_root/view/browser/$path" "public/$path"
done
mapfile -t public_files < <(find public -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
expected_files=(app.css app.js index.html prism_calculator.js prism_calculator_bg.wasm provenance.json)
test "${public_files[*]}" = "${expected_files[*]}" || die 'Pages is not the exact six-file closure'
test -z "$(find public -mindepth 1 -maxdepth 1 ! -type f -print -quit)" ||
  die 'Pages closure contains a non-file entry'
if rg -n 'https?://|XMLHttpRequest|WebSocket|analytics|telemetry' public; then
  die 'portable Pages contains an external network or telemetry surface'
fi
if rg -n '\bfetch\s*\(' public/app.js; then
  die 'portable Calculator behavior contains a network fallback'
fi
if rg -n 'Number\((left|right|a|b)\b' public/app.js; then
  die 'portable Calculator narrows an operand through JavaScript Number'
fi
cargo check --locked --offline
cargo test --locked --offline
cargo clippy --locked --offline --all-targets -- -D warnings
if test "$mode" = --baseline-input; then
  npx --no-install playwright test
else
  npm test
fi
sha256sum --check SHA256SUMS
./scripts/reproduce.sh "$mode"

coverage=.prism/build/$system_b_id/projections/capability-coverage.json
test -f "$coverage" || die 'generated public-feature coverage is absent'
node scripts/verify-coverage.mjs "$coverage"
cmp "$coverage" artifacts/feature-coverage.json
node scripts/verify-system-projections.mjs ".prism/build/$system_a_id" A
node scripts/verify-system-projections.mjs ".prism/build/$system_b_id" B
./scripts/acceptance.sh system "$mode"
if test "$mode" = --baseline-input; then
  ./scripts/acceptance.sh pages --baseline-input
  node scripts/write-baseline-input-evidence.mjs
fi
printf 'Calculator repository verification passed\n'
