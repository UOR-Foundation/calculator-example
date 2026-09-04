set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

# Reproduce and verify the model, package, Holo, Pages projection, and browser acceptance.
vv:
    ./scripts/verify.sh

# Acquire the exact locked dependencies used by the offline acceptance gate.
setup:
    ./scripts/fetch.sh

# Serve the exact generated production closure for manual inspection.
serve:
    npx --no-install http-server public -p 4173 -c-1

# Run browser and accessibility acceptance against a served URL.
browser:
    npm test
