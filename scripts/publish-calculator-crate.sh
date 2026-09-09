#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
trusted_publishing_token=${CARGO_REGISTRY_TOKEN:-}
unset CARGO_REGISTRY_TOKEN
require_sdk_environment
node scripts/verify-baseline.mjs --require-package-bootstrap >/dev/null

build=$(prismpm --json build)
build_id=$(json_field build_id <<<"$build")
verification=$(prismpm --json verify)
test "$(json_field build_id <<<"$verification")" = "$build_id" ||
  die 'crate publication verification did not bind the generated application build'
build_root="$project_root/.prism/build/$build_id"
package_root="$build_root/cargo/package"
attested_archive="$build_root/cargo/prism-calculator-0.1.0.crate"
test -f "$package_root/Cargo.toml" || die 'generated Calculator Cargo source closure is absent'
test -f "$attested_archive" || die 'attested Calculator crate archive is absent'

cargo package --locked --allow-dirty --no-verify \
  --manifest-path "$package_root/Cargo.toml"
cargo_archive="$package_root/target/package/prism-calculator-0.1.0.crate"
cmp "$cargo_archive" "$attested_archive" ||
  die 'pinned Cargo does not reproduce the attested Calculator crate archive'

publication=$(node scripts/check-crate-publication.mjs "$attested_archive" --allow-absent)
if test "$(json_field availability <<<"$publication")" = present; then
  record_json crate-publication "$publication"
  printf '%s\n' 'the exact generated prism-calculator 0.1.0 archive is already public'
  exit 0
fi
: "${trusted_publishing_token:?trusted-publishing token is required for a new crate release}"
CARGO_REGISTRY_TOKEN=$trusted_publishing_token cargo publish --locked --allow-dirty --no-verify \
  --manifest-path "$package_root/Cargo.toml"
cmp "$cargo_archive" "$attested_archive" ||
  die 'Cargo changed the verified archive while publishing'
unset trusted_publishing_token

for attempt in $(seq 1 60); do
  if publication=$(node scripts/check-crate-publication.mjs "$attested_archive" 2>/dev/null); then
    record_json crate-publication "$publication"
    printf '%s\n' 'published and independently verified exact prism-calculator 0.1.0 bytes'
    exit 0
  fi
  sleep 2
done
die 'crates.io did not serve the exact published Calculator archive within 120 seconds'
