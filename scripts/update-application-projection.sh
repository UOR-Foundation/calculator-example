#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_sdk_environment

mapfile -t existing_public_entries < <(find public -mindepth 1 -printf '%P\n' | LC_ALL=C sort)
expected_public_entries=(
  app.css
  app.js
  index.html
  prism_calculator.js
  prism_calculator_bg.wasm
  provenance.json
)
test "${existing_public_entries[*]}" = "${expected_public_entries[*]}" ||
  die 'refusing to overwrite a Pages tree with extra, missing, nested, or non-regular entries'

build=$(prismpm --json build)
build_id=$(json_field build_id <<<"$build")
verify=$(prismpm --json verify)
test "$(json_field build_id <<<"$verify")" = "$build_id" ||
  die 'verification did not bind the generated application build'
attestation_id=$(json_field attestation_id <<<"$verify")
build_root=".prism/build/$build_id"
verified_root=".prism/verified/$attestation_id"
test -d "$build_root" || die 'generated application build root is absent'
test -d "$verified_root" || die 'generated application verification root is absent'

stage=$(mktemp -d "$project_root/.prism/application-projection.XXXXXX")
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
mkdir -p "$stage/artifacts" "$stage/public"
cp "$build_root/Calculator.holo" "$stage/artifacts/Calculator.holo"
cp "$verified_root/application-acceptance.json" \
  "$stage/artifacts/application-acceptance.json"
cp "$build_root/manifest.json" "$stage/artifacts/build-manifest.json"
cp "$build_root/model.prism.json" "$stage/artifacts/model.prism.json"
cp "$verified_root/manifest.json" "$stage/artifacts/verification-manifest.json"
cp "$build_root/view/view-manifest.json" "$stage/artifacts/view-manifest.json"
for path in app.css app.js index.html prism_calculator.js \
  prism_calculator_bg.wasm provenance.json; do
  cp "$build_root/view/browser/$path" "$stage/public/$path"
done

for path in \
  artifacts/Calculator.holo \
  artifacts/application-acceptance.json \
  artifacts/build-manifest.json \
  artifacts/model.prism.json \
  artifacts/verification-manifest.json \
  artifacts/view-manifest.json \
  public/app.css \
  public/app.js \
  public/index.html \
  public/prism_calculator.js \
  public/prism_calculator_bg.wasm \
  public/provenance.json; do
  install -m 0644 "$stage/$path" "$project_root/$path"
done

checksum_paths=(
  artifacts/Calculator.holo
  artifacts/application-acceptance.json
  artifacts/build-manifest.json
  artifacts/calculator-baseline.json
  artifacts/historical-plan-05sep26.md
  artifacts/historical-release-candidate.json
  artifacts/model.prism.json
  artifacts/verification-manifest.json
  artifacts/view-manifest.json
  public/app.css
  public/app.js
  public/index.html
  public/prism_calculator.js
  public/prism_calculator_bg.wasm
  public/provenance.json
)
if test -f artifacts/feature-coverage.json; then
  checksum_paths=(
    artifacts/Calculator.holo
    artifacts/application-acceptance.json
    artifacts/build-manifest.json
    artifacts/calculator-baseline.json
    artifacts/feature-coverage.json
    artifacts/historical-plan-05sep26.md
    artifacts/historical-release-candidate.json
    artifacts/model.prism.json
    artifacts/verification-manifest.json
    artifacts/view-manifest.json
    public/app.css
    public/app.js
    public/index.html
    public/prism_calculator.js
    public/prism_calculator_bg.wasm
    public/provenance.json
  )
fi
sha256sum "${checksum_paths[@]}" >SHA256SUMS

record_json application-projection "$(node - "$build_id" "$attestation_id" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [buildId, attestationId] = process.argv.slice(2);
const files = [
  'artifacts/Calculator.holo',
  'artifacts/application-acceptance.json',
  'artifacts/build-manifest.json',
  'artifacts/model.prism.json',
  'artifacts/verification-manifest.json',
  'artifacts/view-manifest.json',
  'public/app.css',
  'public/app.js',
  'public/index.html',
  'public/prism_calculator.js',
  'public/prism_calculator_bg.wasm',
  'public/provenance.json',
];
const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const artifacts = files.map((path) => ({path, sha256: sha256(fs.readFileSync(path))}));
process.stdout.write(JSON.stringify({
  artifacts,
  attestation_id: attestationId,
  build_id: buildId,
  schema: 'calculator/application-projection/1',
  status: 'generated',
}));
NODE
)"
printf 'generated Calculator application projection %s\n' "$build_id"
