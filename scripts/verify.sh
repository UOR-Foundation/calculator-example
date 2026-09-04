#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

expected_prismpm=$(tr -d '\n' < .prismpm-version)
observed_prismpm=$(git -C vendor/PrismPM rev-parse HEAD)
test "$observed_prismpm" = "$expected_prismpm"
test "$(git -C vendor/PrismPM status --porcelain)" = ""

authoritative=vendor/PrismPM/examples/Calculator
for path in \
  lake-manifest.json \
  lakefile.toml \
  lean-toolchain \
  lexlean.lock \
  lexlean.toml \
  prismpm.toml \
  src/Calculator.lex.tex
do
  cmp "$path" "$authoritative/$path"
done

if git ls-files '*.lean' 'lakefile.lean' | grep -q .; then
  echo "handwritten Lean is not permitted" >&2
  exit 1
fi

prism=(
  cargo run
  --quiet
  --locked
  --offline
  --manifest-path vendor/PrismPM/Cargo.toml
  --package prismpm
  --
  --project "$root"
  --json
)

check_json=$("${prism[@]}" check)
build_json=$("${prism[@]}" build)
repeat_json=$("${prism[@]}" build)
verify_json=$("${prism[@]}" verify)

test "$(jq -r .schema <<<"$check_json")" = "prismpm/check-result/1"
test "$(jq -r .model_id <<<"$check_json")" = "$(jq -r .inputs.model_id artifacts/build-manifest.json)"
build_id=$(jq -r .build_id <<<"$build_json")
test "$build_id" = "$(jq -r .build_id <<<"$repeat_json")"
test "$build_id" = "$(jq -r .build_id artifacts/application-acceptance.json)"
test "$(jq -r .build_id <<<"$verify_json")" = "$build_id"

build_root=.prism/build/$build_id
cmp "$build_root/Calculator.holo" artifacts/Calculator.holo
cmp "$build_root/manifest.json" artifacts/build-manifest.json
cmp "$build_root/model.prism.json" artifacts/model.prism.json
cmp "$build_root/view/view-manifest.json" artifacts/view-manifest.json
cmp "$build_root/cargo/prism-calculator-0.1.0.crate" registry/prism-calculator-0.1.0.crate

for path in app.css app.js index.html prism_calculator.js prism_calculator_bg.wasm provenance.json
do
  cmp "$build_root/view/browser/$path" "public/$path"
done

attestation_id=$(jq -r .attestation_id <<<"$verify_json")
actual_acceptance=.prism/verified/$attestation_id/application-acceptance.json
actual_verification=.prism/verified/$attestation_id/manifest.json
test "$(jq -r .status "$actual_acceptance")" = "verified"
cmp artifacts/application-acceptance.json "$actual_acceptance"
cmp artifacts/verification-manifest.json "$actual_verification"

mapfile -t public_files < <(find public -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)
expected_files=(app.css app.js index.html prism_calculator.js prism_calculator_bg.wasm provenance.json)
test "${public_files[*]}" = "${expected_files[*]}"
test -z "$(find public -mindepth 1 -maxdepth 1 ! -type f -print -quit)"
if rg -n 'https?://|XMLHttpRequest|WebSocket|analytics|telemetry' public; then
  echo "production closure contains an external network or telemetry surface" >&2
  exit 1
fi
if rg -n 'fetch\(' public/app.js; then
  echo "application behavior contains a network fallback" >&2
  exit 1
fi
if rg -n 'Number\((left|right|a|b)\b' public/app.js; then
  echo "operand precision is narrowed through JavaScript Number" >&2
  exit 1
fi

registry_home=$(mktemp -d)
repro_root=$(mktemp -d)
cleanup() {
  rm -rf "$registry_home" "$repro_root"
}
trap cleanup EXIT

printf '[net]\noffline = true\n\n[source.crates-io]\nreplace-with = "calculator-candidate"\n\n[source.calculator-candidate]\nlocal-registry = "%s"\n' \
  "$root/registry" > "$registry_home/config.toml"
CARGO_HOME="$registry_home" cargo generate-lockfile --offline
CARGO_HOME="$registry_home" cargo check --locked --offline
CARGO_HOME="$registry_home" cargo test --locked --offline
CARGO_HOME="$registry_home" cargo clippy --locked --offline --all-targets -- -D warnings

mkdir -p "$repro_root/src"
for path in lake-manifest.json lakefile.toml lean-toolchain lexlean.lock lexlean.toml prismpm.toml
do
  cp "$path" "$repro_root/$path"
done
cp src/Calculator.lex.tex "$repro_root/src/Calculator.lex.tex"
repro_json=$(
  cargo run \
    --quiet \
    --locked \
    --offline \
    --manifest-path vendor/PrismPM/Cargo.toml \
    --package prismpm \
    -- \
    --project "$repro_root" \
    --json \
    build
)
test "$(jq -r .build_id <<<"$repro_json")" = "$build_id"
diff -qr "$build_root" "$repro_root/.prism/build/$build_id"

npm test
sha256sum --check SHA256SUMS

release=RELEASE-CANDIDATE.json
sha256_file() {
  sha256sum "$1" | cut -d ' ' -f 1
}
dependency_revision() {
  local dependency=$1
  awk -v dependency="$dependency" '
    $0 == "[[dependency]]" { in_dependency = 1; matched = 0; next }
    in_dependency && $0 == "id = \"" dependency "\"" { matched = 1; next }
    matched && /^revision = / {
      gsub(/^revision = \"|\"$/, "")
      print
      exit
    }
  ' vendor/PrismPM/model/dependencies.toml
}

test "$(jq -r .schema "$release")" = "calculator-example/release-candidate/1"
test "$(jq -r .application "$release")" = "Calculator"
test "$(jq -r .build_id "$release")" = "$build_id"
test "$(jq -r .application_acceptance.status "$release")" = "verified"
test "$(jq -r .application_acceptance.artifact_sha256 "$release")" = \
  "$(sha256_file artifacts/application-acceptance.json)"
test "$(jq -r .application_acceptance.verification_manifest_sha256 "$release")" = \
  "$(sha256_file artifacts/verification-manifest.json)"
test "$(jq -r .dependencies.prismpm_commit "$release")" = "$expected_prismpm"
test "$(jq -r .dependencies.lean4_prod_commit "$release")" = \
  "$(dependency_revision lean4-prod)"
test "$(jq -r .dependencies.lexlean_commit "$release")" = \
  "$(dependency_revision lexlean)"
test "$(jq -r .dependencies.hologram_live_commit "$release")" = \
  "$(dependency_revision hologram-live)"
test "$(jq -r .dependencies.uor_hologram_commit "$release")" = \
  "$(dependency_revision uor-hologram)"
test "$(jq -r .holo.sha256 "$release")" = "$(sha256_file artifacts/Calculator.holo)"
test "$(jq -Sc .holo "$release" | jq -Sc 'del(.sha256)')" = \
  "$(jq -Sc .holo artifacts/application-acceptance.json)"
test "$(jq -r .model.model_id "$release")" = \
  "$(sha256_file artifacts/model.prism.json)"
test "$(jq -r .model.model_id "$release")" = "$(jq -r .model_id public/provenance.json)"
test "$(jq -r .model.source_id "$release")" = "$(jq -r .source_id artifacts/application-acceptance.json)"
test "$(jq -r .model.source_root_sha256 "$release")" = \
  "$(sha256_file src/Calculator.lex.tex)"
test "$(jq -r .model.generated_core_sha256 "$release")" = \
  "$(jq -r .generated_core_sha256 public/provenance.json)"
test "$(jq -r .model.view_model_id "$release")" = \
  "$(jq -r .view_model_id public/provenance.json)"
test "$(jq -r '.packages[] | select(.name == "prism-calculator") | .sha256' "$release")" = \
  "$(sha256_file registry/prism-calculator-0.1.0.crate)"
test "$(jq -r '.packages[] | select(.name == "prism-stdlib") | .sha256' "$release")" = \
  "$(sha256_file registry/prism-stdlib-0.1.0.crate)"
production_manifest_sha=$(
  find public -mindepth 1 -maxdepth 1 -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 sha256sum |
    sha256sum |
    cut -d ' ' -f 1
)
test "$(jq -r .pages.production_manifest_sha256 "$release")" = \
  "$production_manifest_sha"

git diff --exit-code -- public artifacts registry src/Calculator.lex.tex

printf 'calculator-example acceptance passed: build=%s verification=%s\n' \
  "$build_id" "$attestation_id"
