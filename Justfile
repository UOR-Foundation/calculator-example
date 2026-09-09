set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

# Reproduce and verify both modeled releases, Pages, packages, and repository policy.
vv:
    ./scripts/verify.sh

# Run the complete Calculator closure before its first seal exists. This is
# the only pre-seal path; it emits the evidence that the baseline records.
baseline-input:
    ./scripts/verify.sh --baseline-input

# Acquire the exact authority and package inputs declared by the committed locks.
setup:
    prismpm fetch --locked

# Regenerate the project-owned conformance document from the two authoritative
# system releases. `prismpm template check` runs this in an isolated copy.
model-write:
    node scripts/write-conformance.mjs

# Replace committed application artifacts and the six-file Pages closure only
# with exact output from the locked PrismPM application build and verification.
update-application-projection:
    ./scripts/update-application-projection.sh

verify-application-projection:
    ./scripts/verify-application-projection.sh

# Replace the committed capability-coverage projection only with the exact
# release-B output after every row and the complete system projection pass.
update-system-projection:
    ./scripts/update-system-projection.sh

verify-system-projection:
    ./scripts/verify-system-projection.sh

# After committing the generated projection and publishing both required
# crates, capture their real bytes and prepare the unsealed Pages input commit.
prepare-baseline checked_on: verify-application-projection
    node scripts/prepare-baseline.mjs '{{checked_on}}'
    node scripts/verify-baseline.mjs --require-input-ready

# Used only by the protected crates.io trusted-publishing workflow. Pinned
# Cargo must reproduce the already-attested archive before it may upload it.
publish-calculator-crate:
    ./scripts/publish-calculator-crate.sh

# Seal five exact clean repository transcripts into the one-shot baseline.
seal-baseline evidence_directory:
    node scripts/seal-baseline.mjs '{{evidence_directory}}'
    node scripts/verify-baseline.mjs --require-sealed --live
    sha256sum --check SHA256SUMS

test-baseline-evidence:
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

# Falsify each formal SystemModel validator with a distinct authoritative-model
# mutation while keeping its generated SystemManifest fixed.
test-formal-model-mutations:
    node scripts/test-formal-model-mutations.mjs

# Build the two immutable production release graphs once.
build:
    ./scripts/build.sh

# Exercise the real Compose system, including migration, rollback, backup,
# restore, drift, security, SLO, and cleanup behavior.
accept-compose:
    ./scripts/acceptance.sh compose

# Exercise the same product release in a clean Kubernetes 1.36.4 Kind cluster.
accept-kind:
    ./scripts/acceptance.sh kind

# Execute the SDK's complete per-feature and per-diagnostic conformance corpus
# and attach its exact digest-bound transcript to both modeled releases.
accept-conformance:
    ./scripts/acceptance.sh conformance

# Exercise Compose, Kind, and exact-release conformance without publishing;
# this is the protected CI acceptance boundary between candidate and accepted.
accept-system:
    ./scripts/acceptance.sh system

# Run the live GitHub Pages and exact-served-byte acceptance.
accept-pages:
    ./scripts/acceptance.sh pages

# Run every infrastructure acceptance suite. This requires Docker and network.
accept-production:
    ./scripts/acceptance.sh all

# Serve the exact generated production closure for manual inspection.
serve:
    npx --no-install http-server public -p 4173 -c-1

# Run browser and accessibility acceptance against a served URL.
browser:
    node scripts/verify-baseline.mjs --require-sealed
    npm test
