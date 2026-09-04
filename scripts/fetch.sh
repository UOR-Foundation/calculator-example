#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

cargo fetch --locked --manifest-path vendor/PrismPM/Cargo.toml

oracle_work=$(mktemp -d)
cleanup() {
  rm -rf "$oracle_work"
}
trap cleanup EXIT

mkdir -p "$oracle_work/hologram-live" "$oracle_work/harness/src"
tar -xf vendor/PrismPM/crates/prismpm/vendor/hologram-live.tar \
  -C "$oracle_work/hologram-live"
cp vendor/PrismPM/tests/hologram-oracle/Cargo.toml "$oracle_work/harness/Cargo.toml"
cp vendor/PrismPM/tests/hologram-oracle/Cargo.lock "$oracle_work/harness/Cargo.lock"
cp vendor/PrismPM/tests/hologram-oracle/src/main.rs "$oracle_work/harness/src/main.rs"
cargo fetch --locked --manifest-path "$oracle_work/harness/Cargo.toml"

npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
npm audit --audit-level=high --package-lock-only
