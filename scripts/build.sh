#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_sdk

repository=$(release_repository)
build_release() {
  local release=$1
  local result
  result=$(prismpm --json build --locked --release "$release" --tag "$repository:${release,,}-candidate")
  record_json "release-${release,,}" "$result"
  digest_reference "$repository" "$result"
}

a_reference=$(build_release A)
b_reference=$(build_release B)
test "$a_reference" != "$b_reference" || die 'releases A and B have the same digest'
printf 'CALCULATOR_RELEASE_A=%q\nCALCULATOR_RELEASE_B=%q\n' "$a_reference" "$b_reference" >.prism/repository-evidence/releases.env
printf 'built Calculator A=%s B=%s\n' "$a_reference" "$b_reference"
