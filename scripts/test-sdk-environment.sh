#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_sdk_environment
shadow=$(mktemp -d /tmp/calculator-sdk-shadow.XXXXXX)
cleanup() { rm -rf "$shadow"; }
trap cleanup EXIT
cp /usr/bin/false "$shadow/lexlean"
if failure=$(PATH="$shadow:$PATH" require_sdk_environment 2>&1); then
  die 'a project/host executable was accepted ahead of the SDK LexLean binary'
fi
grep -q 'lexlean resolves outside the SDK inventory' <<<"$failure" ||
  die "SDK shadow defect failed for the wrong reason: $failure"
mkdir -p "$shadow/docker/cli-plugins"
cp /usr/bin/false "$shadow/docker/cli-plugins/docker-buildx"
if failure=$(DOCKER_CONFIG="$shadow/docker" require_sdk_environment 2>&1); then
  die 'a host/user Docker CLI plugin was accepted ahead of the SDK plugin'
fi
grep -q 'host/user Docker CLI plugins are mounted into the SDK' <<<"$failure" ||
  die "Docker plugin shadow defect failed for the wrong reason: $failure"
printf 'SDK executable closure positive and planted-shadow tests passed\n'
