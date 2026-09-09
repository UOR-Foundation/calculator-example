#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_sdk_environment

build=$(prismpm --json build)
build_id=$(json_field build_id <<<"$build")
verify=$(prismpm --json verify)
test "$(json_field build_id <<<"$verify")" = "$build_id" ||
  die 'verification did not bind the generated application build'
attestation_id=$(json_field attestation_id <<<"$verify")
build_root=".prism/build/$build_id"
verified_root=".prism/verified/$attestation_id"
cmp "$build_root/Calculator.holo" artifacts/Calculator.holo
cmp "$verified_root/application-acceptance.json" artifacts/application-acceptance.json
cmp "$build_root/manifest.json" artifacts/build-manifest.json
cmp "$build_root/model.prism.json" artifacts/model.prism.json
cmp "$verified_root/manifest.json" artifacts/verification-manifest.json
cmp "$build_root/view/view-manifest.json" artifacts/view-manifest.json
for path in app.css app.js index.html prism_calculator.js \
  prism_calculator_bg.wasm provenance.json; do
  cmp "$build_root/view/browser/$path" "public/$path"
done
mapfile -t public_files < <(find public -mindepth 1 -printf '%P\n' | LC_ALL=C sort)
expected_files=(app.css app.js index.html prism_calculator.js prism_calculator_bg.wasm provenance.json)
test "${public_files[*]}" = "${expected_files[*]}" ||
  die 'Pages contains an extra, missing, nested, or non-regular closure entry'
sha256sum --check SHA256SUMS
printf 'Calculator application projection %s is exact\n' "$build_id"
