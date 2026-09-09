#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sdk_ref=${1:-}
action_ref=${2:-}
template_revision=${3:-}
runtime_ref=${4:-}

if [ "$#" -ne 4 ]; then
  printf '%s\n' 'usage: bootstrap/render.sh SDK_IMAGE@sha256:DIGEST UOR-Foundation/PrismPM/action@COMMIT POLICY_INPUT_COMMIT ghcr.io/uor-foundation/prismpm-runtime@sha256:DIGEST' >&2
  exit 64
fi

case "$sdk_ref" in
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    printf '%s\n' 'SDK_IMAGE must be an OCI image name and lowercase SHA-256 manifest digest' >&2
    exit 64
    ;;
esac

case "$runtime_ref" in
  ghcr.io/uor-foundation/prismpm-runtime@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    printf '%s\n' 'RUNTIME_IMAGE must select the public PrismPM runtime at a lowercase SHA-256 index digest' >&2
    exit 64
    ;;
esac
runtime_digest=${runtime_ref##*@sha256:}
case "$runtime_digest" in
  *[!0-9a-f]*)
    printf '%s\n' 'RUNTIME_IMAGE contains a non-lowercase-hex digest' >&2
    exit 64
    ;;
esac

case "$action_ref" in
  UOR-Foundation/PrismPM/action@????????????????????????????????????????) ;;
  *)
    printf '%s\n' 'ACTION_REFERENCE must select the PrismPM action at a full commit' >&2
    exit 64
    ;;
esac
action_revision=${action_ref##*@}
case "$action_revision" in
  *[!0-9a-f]*)
    printf '%s\n' 'ACTION_REFERENCE contains a non-lowercase-hex commit' >&2
    exit 64
    ;;
esac

digest=${sdk_ref##*@sha256:}
image_name=${sdk_ref%@sha256:*}
case "$digest" in
  *[!0-9a-f]*)
    printf '%s\n' 'SDK_IMAGE contains a non-lowercase-hex digest' >&2
    exit 64
    ;;
esac
case "$image_name" in
  ''|*[!a-z0-9./_:-]*)
    printf '%s\n' 'SDK_IMAGE contains a malformed OCI image name' >&2
    exit 64
    ;;
esac

case "$template_revision" in
  ????????????????????????????????????????) ;;
  *)
    printf '%s\n' 'POLICY_INPUT_COMMIT must be a complete 40-character commit' >&2
    exit 64
    ;;
esac
case "$template_revision" in
  *[!0-9a-f]*)
    printf '%s\n' 'POLICY_INPUT_COMMIT contains a non-lowercase-hex commit' >&2
    exit 64
    ;;
esac

# `template_revision` identifies the reviewed UOR template policy input. It is
# intentionally not the downstream Calculator repository revision. The first
# SDK migration has neither lock tracked yet, so its reviewed worktree is the
# transaction input. Once either lock has been committed, both must be tracked
# and every policy input must be committed and clean before any future update.
sdk_lock_tracked=false
template_lock_tracked=false
git -C "$repository_root" ls-files --error-unmatch prismpm.lock >/dev/null 2>&1 &&
  sdk_lock_tracked=true
git -C "$repository_root" ls-files --error-unmatch template.lock >/dev/null 2>&1 &&
  template_lock_tracked=true
if [ "$sdk_lock_tracked" != "$template_lock_tracked" ]; then
  printf '%s\n' 'prismpm.lock and template.lock must become policy inputs together' >&2
  exit 64
fi
initial_migration=false
if [ "$sdk_lock_tracked" = false ]; then
  initial_migration=true
fi
set -- \
  .devcontainer/devcontainer.json \
  .github/workflows/bootstrap.yml \
  .github/workflows/prismpm.yml \
  .github/workflows/template-update.yml \
  AGENTS.md CONFORMANCE.md TEMPLATE-CONTRACT.md VERIFICATION.md \
  bootstrap/render.mjs bootstrap/render.sh scripts/runtime-binding.mjs \
  scripts/update-runtime-binding.mjs src/CalculatorSystem.lex.tex lexlean.lock \
  template-contract.json
for path do
  if [ ! -f "$repository_root/$path" ]; then
    printf '%s\n' "policy input is absent or not a regular file: $path" >&2
    exit 64
  fi
  if [ "$initial_migration" = false ] &&
     ! git -C "$repository_root" ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    printf '%s\n' "policy input is not committed: $path" >&2
    exit 64
  fi
done
if [ "$initial_migration" = false ] &&
   { ! git -C "$repository_root" diff --quiet -- "$@" ||
     ! git -C "$repository_root" diff --cached --quiet -- "$@"; }; then
  printf '%s\n' 'uncommitted universal policy changes must be committed before rendering' >&2
  exit 64
fi

transaction=$(mktemp -d)
transaction_complete=false
present=$transaction/present
outputs=$transaction/outputs
: >"$present"
set -- \
  .devcontainer/devcontainer.json \
  .github/workflows/bootstrap.yml \
  .github/workflows/pages.yml \
  .github/workflows/platform-equivalence.yml \
  .github/workflows/prismpm.yml \
  .github/workflows/production.yml \
  .github/workflows/publish-crate.yml \
  .github/workflows/template-update.yml \
  .github/workflows/verify.yml \
  prismpm.lock standards.lock template-contract.json template.lock \
  src/CalculatorSystem.lex.tex lexlean.lock
printf '%s\n' "$@" >"$outputs"
for path do
  if [ -e "$repository_root/$path" ] && [ ! -f "$repository_root/$path" ]; then
    printf '%s\n' "render output is not a regular file: $path" >&2
    rm -rf "$transaction"
    exit 64
  fi
  if [ -f "$repository_root/$path" ]; then
    mkdir -p "$transaction/$(dirname "$path")"
    cp -p "$repository_root/$path" "$transaction/$path"
    printf '%s\n' "$path" >>"$present"
  fi
done
restore_render_transaction() {
  if [ "$transaction_complete" != true ]; then
    while IFS= read -r path; do
      if grep -Fqx "$path" "$present"; then
        cp -p "$transaction/$path" "$repository_root/$path"
      else
        rm -f "$repository_root/$path"
      fi
    done <"$outputs"
  fi
  rm -rf "$transaction"
}
trap restore_render_transaction EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --volume "$repository_root:/workspace" \
  --workdir /workspace \
  --entrypoint node \
  "$sdk_ref" \
  bootstrap/render.mjs "$sdk_ref" "$action_ref" "$template_revision"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --env "CALCULATOR_RUNTIME_REFERENCE=$runtime_ref" \
  --volume "$repository_root:/workspace" \
  --workdir /workspace \
  --entrypoint bash \
  "$sdk_ref" -eu -o pipefail -c '
    prismpm fetch --locked
    node scripts/update-runtime-binding.mjs "$CALCULATOR_RUNTIME_REFERENCE"
    lexlean lock --project lexlean.toml --diagnostic-format human --color never
  '
transaction_complete=true
trap - EXIT HUP INT TERM
rm -rf "$transaction"
