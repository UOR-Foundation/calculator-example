#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
mode=${1:-}
case "$mode" in
  '') require_sdk ;;
  --baseline-input)
    require_sdk_environment
    node scripts/verify-baseline.mjs --require-input-ready >/dev/null
    ;;
  *) die 'usage: scripts/reproduce.sh [--baseline-input]' ;;
esac

first=$(mktemp -d /tmp/calculator-repro-a.XXXXXX)
second=$(mktemp -d /tmp/calculator-repro-b.XXXXXX)
cleanup() {
  rm -rf "$first" "$second"
}
trap cleanup EXIT

copy_closure() {
  local destination=$1
  test -d .prism/sdk/inputs ||
    die 'locked SDK model inputs are absent; run just setup first'
  test -f .prism/sdk/stdlib-manifest.json ||
    die 'locked SDK input manifest is absent; run just setup first'
  mkdir -p "$destination/src" "$destination/.prism/sdk"
  cp Cargo.toml Cargo.lock lake-manifest.json lakefile.toml lean-toolchain \
    lexlean.lock lexlean.toml prismpm.lock prismpm.toml standards.lock \
    template-contract.json template.lock "$destination/"
  cp src/Calculator.lex.tex src/CalculatorSystem.lex.tex "$destination/src/"
  cp -R .prism/sdk/inputs "$destination/.prism/sdk/inputs"
  cp .prism/sdk/stdlib-manifest.json "$destination/.prism/sdk/stdlib-manifest.json"
  diff -qr .prism/sdk/inputs "$destination/.prism/sdk/inputs"
  cmp .prism/sdk/stdlib-manifest.json "$destination/.prism/sdk/stdlib-manifest.json"
}
copy_closure "$first"
copy_closure "$second"

build_at() {
  local root=$1
  local release=$2
  prismpm --project "$root" --json build --locked --release "$release" \
    --tag "example.invalid/uor/calculator-system:${release,,}-reproduction"
}
for release in A B; do
  a=$(build_at "$first" "$release")
  b=$(build_at "$second" "$release")
  test "$(json_field build_id <<<"$a")" = "$(json_field build_id <<<"$b")" ||
    die "release $release changed between absolute roots"
  id=$(json_field build_id <<<"$a")
  diff -qr "$first/.prism/build/$id" "$second/.prism/build/$id"
  test "$(json_field release_digest <<<"$a")" = "$(json_field release_digest <<<"$b")" ||
    die "release $release OCI graph changed between absolute roots"
done

pages_a=$(prismpm --project "$first" --json build --locked)
pages_b=$(prismpm --project "$second" --json build --locked)
test "$(json_field build_id <<<"$pages_a")" = "$(json_field build_id <<<"$pages_b")" ||
  die 'Pages application changed between absolute roots'
pages_id=$(json_field build_id <<<"$pages_a")
diff -qr "$first/.prism/build/$pages_id" "$second/.prism/build/$pages_id"
