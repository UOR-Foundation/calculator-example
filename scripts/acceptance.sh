#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
suite=${1:-all}
case "$suite" in
  all|compose|conformance|kind|pages|roundtrip|system) ;;
  *) die 'usage: scripts/acceptance.sh all|compose|conformance|kind|pages|roundtrip|system' ;;
esac
mode=${2:-}
case "$mode" in
  '') require_sdk ;;
  --baseline-input)
    require_sdk_environment
    node scripts/verify-baseline.mjs --require-input-ready >/dev/null
    ;;
  --projection-bootstrap)
    test "$suite" = pages || die 'projection bootstrap is confined to Pages acceptance'
    require_sdk_environment
    node scripts/verify-baseline.mjs --require-projection-bootstrap >/dev/null
    ;;
  *) die 'unknown acceptance phase' ;;
esac

if test "$suite" = system || test "$suite" = all; then
  node scripts/verify-external-images.mjs
fi

calculator_secret_root=
calculator_kubeconfig=
calculator_kind_config=
calculator_pull_root=

cleanup() {
  if test -n "${CALCULATOR_RELEASE_A:-}"; then
    prismpm --json destroy "$CALCULATOR_RELEASE_A" --target compose-restore --authorized >/dev/null 2>&1 || true
    prismpm --json destroy "$CALCULATOR_RELEASE_A" --target compose-local --authorized >/dev/null 2>&1 || true
  fi
  if test -n "${CALCULATOR_RELEASE_B:-}"; then
    prismpm --json destroy "$CALCULATOR_RELEASE_B" --target kubernetes-kind-restore --authorized >/dev/null 2>&1 || true
    prismpm --json destroy "$CALCULATOR_RELEASE_B" --target compose-local --authorized >/dev/null 2>&1 || true
    prismpm --json destroy "$CALCULATOR_RELEASE_B" --target kubernetes-kind --authorized >/dev/null 2>&1 || true
  fi
  kind delete cluster --name calculator-acceptance >/dev/null 2>&1 || true
  if test -n "$calculator_secret_root"; then
    rm -rf "$calculator_secret_root"
  fi
  if test -n "$calculator_kubeconfig"; then
    rm -f "$calculator_kubeconfig"
  fi
  if test -n "$calculator_kind_config"; then
    rm -f "$calculator_kind_config"
  fi
  if test -n "$calculator_pull_root"; then
    rm -rf "$calculator_pull_root"
  fi
}
trap cleanup EXIT

create_kind_cluster() {
  local cluster=$1
  kind create cluster --name "$cluster" \
    --image docker.io/kindest/node@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed \
    --config "$calculator_kind_config" \
    --kubeconfig "$KUBECONFIG" \
    --wait 180s
  test "$(kubectl version -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).serverVersion.gitVersion))')" = v1.36.4 ||
    die 'Kind server is not Kubernetes v1.36.4'
}

kind_ingress_address() {
  local address=127.0.0.1
  if test -n "${HOSTNAME:-}" && docker inspect "$HOSTNAME" >/dev/null 2>&1; then
    address=$(docker inspect "$HOSTNAME" | node -e \
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=Object.values(JSON.parse(s)[0].NetworkSettings.Networks);process.stdout.write(n[0]?.Gateway??"")})')
  fi
  test -n "$address" || die 'cannot resolve the Kind ingress host from this SDK container'
  printf '%s\n' "$address"
}

wait_kind_ingress() {
  local address=$1 expected_release=$2
  local url=https://calculator.local:18443 deadline
  kubectl --namespace ingress-nginx rollout status deployment/ingress-nginx-controller \
    --timeout=180s >/dev/null
  deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if curl --insecure --silent --fail --resolve "calculator.local:18443:$address" \
      "$url/app.js" | rg -q "\"release\":\"$expected_release\""; then
      return 0
    fi
    sleep 1
  done
  die "release-$expected_release Kind TLS ingress did not become reachable"
}

prepare_secrets() {
  if test -n "${PRISMPM_SECRET_DIR:-}"; then
    local supplied_secret_dir=$PRISMPM_SECRET_DIR
    test -f "$supplied_secret_dir/calculator/broker-password" ||
      die 'the modeled broker secret is absent'
    test -f "$supplied_secret_dir/calculator/database-password" ||
      die 'the modeled database secret is absent'
    test -f "$supplied_secret_dir/calculator/oidc-signing-key" ||
      die 'the modeled OIDC signing key is absent'
    test -f "$supplied_secret_dir/calculator/tls-certificate" ||
      die 'the modeled TLS secret is absent'
    # Acceptance rotates credentials and certificates. Work from an isolated
    # copy so a caller-supplied provider directory is never modified.
    mkdir -p .prism
    calculator_secret_root=$(mktemp -d "$project_root/.prism/secrets.XXXXXX")
    umask 077
    mkdir -p "$calculator_secret_root/calculator"
    cp "$supplied_secret_dir/calculator/broker-password" \
      "$supplied_secret_dir/calculator/database-password" \
      "$supplied_secret_dir/calculator/oidc-signing-key" \
      "$supplied_secret_dir/calculator/tls-certificate" \
      "$calculator_secret_root/calculator/"
    export PRISMPM_SECRET_DIR=$calculator_secret_root
    return
  fi

  mkdir -p .prism
  calculator_secret_root=$(mktemp -d "$project_root/.prism/secrets.XXXXXX")
  umask 077
  mkdir -p "$calculator_secret_root/calculator"
  openssl rand -hex 32 >"$calculator_secret_root/calculator/broker-password"
  openssl rand -hex 32 >"$calculator_secret_root/calculator/database-password"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$calculator_secret_root/calculator/oidc-signing-key" >/dev/null 2>&1
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=calculator.local' \
    -keyout "$calculator_secret_root/tls.key" \
    -out "$calculator_secret_root/tls.crt" >/dev/null 2>&1
  node -e \
    'const fs=require("fs");process.stdout.write(JSON.stringify({cert:fs.readFileSync(process.argv[1],"utf8"),key:fs.readFileSync(process.argv[2],"utf8")}))' \
    "$calculator_secret_root/tls.crt" "$calculator_secret_root/tls.key" \
    >"$calculator_secret_root/calculator/tls-certificate"
  export PRISMPM_SECRET_DIR=$calculator_secret_root
}

provision_kubernetes_secrets() {
  local namespace=calculator-system
  if test -z "$calculator_secret_root"; then
    calculator_secret_root=$(mktemp -d "$project_root/.prism/kubernetes-tls.XXXXXX")
  fi
  if test ! -f "$calculator_secret_root/tls.crt" ||
    test ! -f "$calculator_secret_root/tls.key"; then
    node -e \
      'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],value.cert);fs.writeFileSync(process.argv[3],value.key)' \
      "$PRISMPM_SECRET_DIR/calculator/tls-certificate" \
      "$calculator_secret_root/tls.crt" "$calculator_secret_root/tls.key"
  fi
  kubectl create namespace "$namespace" --dry-run=client --output yaml | kubectl apply -f -
  for binding in \
    broker-credentials:broker-password \
    oidc-signing-key:oidc-signing-key \
    rabbitmq-default-pass:broker-password \
    database-credentials:database-password \
    postgres-password:database-password; do
    local name=${binding%%:*} file=${binding#*:}
    kubectl --namespace "$namespace" create secret generic "$name" \
      --from-file="value=$PRISMPM_SECRET_DIR/calculator/$file" \
      --dry-run=client --output yaml | kubectl apply -f -
  done
  # The same modeled TLS reference is consumed as a JSON bundle by the
  # generated browser and as a standard kubernetes.io/tls Secret by Ingress.
  kubectl --namespace "$namespace" create secret generic tls-certificate \
    --type kubernetes.io/tls \
    --from-file="value=$PRISMPM_SECRET_DIR/calculator/tls-certificate" \
    --from-file="tls.crt=$calculator_secret_root/tls.crt" \
    --from-file="tls.key=$calculator_secret_root/tls.key" \
    --dry-run=client --output yaml | kubectl apply -f -
}

production_api_acceptance() {
  local release=$1 name=$2 url=${3:-https://127.0.0.1:8080} connect_address=${4:-}
  local result
  result=$(NODE_TLS_REJECT_UNAUTHORIZED=0 \
    CALCULATOR_CONNECT_ADDRESS="$connect_address" \
    CALCULATOR_EXPECTED_RELEASE="$release" CALCULATOR_PRODUCTION_URL="$url" \
    node scripts/accept-system-api.mjs)
  record_json "$name" "$result"
  printf '%s\n' "$result"
}

verify_cloud_event_contract() {
  local event_json=$1 profile_json=$2 event_id=$3 request_id=$4 subject=$5 sequence=$6
  EVENT_JSON="$event_json" PROFILE_JSON="$profile_json" EVENT_ID="$event_id" \
    REQUEST_ID="$request_id" SUBJECT="$subject" SEQUENCE="$sequence" node <<'NODE'
const assert = require('node:assert/strict');
const event = JSON.parse(process.env.EVENT_JSON);
const profile = JSON.parse(process.env.PROFILE_JSON);
assert.deepEqual(Object.keys(event).sort(), ['data', 'id', 'source', 'specversion', 'subject', 'type']);
assert.equal(event.specversion, '1.0');
assert.equal(event.id, process.env.EVENT_ID);
assert.equal(event.source, profile.event_source);
assert.equal(event.subject, process.env.REQUEST_ID);
assert.equal(event.data[profile.command_id_field], process.env.REQUEST_ID);
assert.equal(event.data.subject, process.env.SUBJECT);
assert.equal(event.data.sequence, process.env.SEQUENCE);
assert(['succeeded', 'rejected'].includes(event.data.outcome?.kind));
assert.equal(event.type, event.data.outcome.kind === 'succeeded'
  ? profile.accepted_event_type : profile.rejected_event_type);
const expectedDataKeys = [
  profile.command_id_field, profile.operation_field, profile.input_a_field,
  profile.input_b_field, 'outcome', 'sequence', 'subject',
  ...(profile.optional_annotation === 'optional' ? [profile.annotation_field] : []),
].sort();
assert.deepEqual(Object.keys(event.data).sort(), expectedDataKeys);
NODE
}

verify_compose_data_plane() {
  local target=$1 api_result=$2
  local database_container api_container telemetry_container request_id rejected_request_id subject event_id rejected_event_id
  local expected_event_id event_json profile_json sequence release deadline state temporary
  request_id=$(json_field concurrent_request_id <<<"$api_result")
  rejected_request_id=$(json_field rejected_request_id <<<"$api_result")
  subject=$(json_field concurrent_subject <<<"$api_result")
  release=$(json_field release <<<"$api_result")
  database_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=database' --format '{{.ID}}')
  api_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=api' --format '{{.ID}}' | head -n 1)
  telemetry_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=telemetry' --format '{{.ID}}')
  test -n "$database_container" || die 'database container is absent for data-plane acceptance'
  test -n "$api_container" || die 'API container is absent for data-plane acceptance'
  test -n "$telemetry_container" || die 'Collector container is absent for telemetry acceptance'

  deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    state=$(docker exec "$database_container" psql -U calculator -d calculator -At \
      -v ON_ERROR_STOP=1 -c \
      "SELECT count(*) || ':' || (SELECT count(*) FROM command_outbox WHERE event_id IN (SELECT event_id FROM command_audit)) FROM command_history WHERE request_id = '$request_id';")
    test "$state" = 1:1 && break
    sleep 1
  done
  test "$state" = 1:1 || die 'history/outbox/audit transaction did not converge'
  event_id=$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT event_id FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$request_id';")
  test -n "$event_id" || die 'modeled CloudEvent identity is absent'
  expected_event_id=$(printf '%s\0%s' "$subject" "$request_id" | sha256sum | cut -d' ' -f1)
  test "$event_id" = "$expected_event_id" ||
    die 'CloudEvent identity is not the modeled subject/request SHA-256 derivation'
  event_json=$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT event::text FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$request_id';")
  sequence=$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT sequence FROM command_history WHERE request_id = '$request_id';")
  profile_json=$(docker exec "$api_container" node -e \
    'process.stdout.write(require("fs").readFileSync("/opt/prism/release/runtime-contract.json","utf8"))')
  verify_cloud_event_contract "$event_json" "$profile_json" "$event_id" \
    "$request_id" "$subject" "$sequence"
  rejected_event_id=$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT event_id FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$rejected_request_id';")
  expected_event_id=$(printf '%s\0%s' "$subject" "$rejected_request_id" | sha256sum | cut -d' ' -f1)
  test "$rejected_event_id" = "$expected_event_id" ||
    die 'rejected CloudEvent identity is not the modeled subject/request SHA-256 derivation'
  event_json=$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT event::text FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$rejected_request_id';")
  sequence=$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT sequence FROM command_history WHERE request_id = '$rejected_request_id';")
  verify_cloud_event_contract "$event_json" "$profile_json" "$rejected_event_id" \
    "$rejected_request_id" "$subject" "$sequence"
  test "$(docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM command_outbox WHERE event_id='$rejected_event_id';")" = 1 ||
    die 'rejected calculation did not produce exactly one modeled outbox fact'
  deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    state=$(docker exec "$database_container" psql -U calculator -d calculator -At \
      -v ON_ERROR_STOP=1 -c \
      "SELECT published || ':' || (SELECT count(*) FROM command_audit WHERE event_id='$rejected_event_id') FROM command_outbox WHERE event_id='$rejected_event_id';")
    test "$state" = true:1 && break
    sleep 1
  done
  test "$state" = true:1 || die 'rejected calculation outbox fact did not publish and audit once'
  for attempt in 1 2; do
    docker exec "$database_container" psql -U calculator -d calculator -At \
      -v ON_ERROR_STOP=1 -c \
      "UPDATE command_outbox SET published=false, published_at=NULL WHERE event_id='$event_id';" >/dev/null
    deadline=$((SECONDS + 20))
    while (( SECONDS < deadline )); do
      state=$(docker exec "$database_container" psql -U calculator -d calculator -At \
        -v ON_ERROR_STOP=1 -c \
        "SELECT (SELECT published FROM command_outbox WHERE event_id='$event_id') || ':' || (SELECT count(*) FROM command_audit WHERE event_id='$event_id');")
      test "$state" = true:1 && break
      sleep 1
    done
    test "$state" = true:1 || die "outbox retry $attempt did not publish once and remain audit-deduplicated"
  done

  # The Collector's file exporters are observed, not treated as source. The
  # canary must be absent while the non-sensitive correlation ID is present.
  sleep 2
  temporary=$(mktemp -d /tmp/calculator-telemetry.XXXXXX)
  docker cp "$telemetry_container:/var/lib/prismpm-telemetry/." "$temporary" >/dev/null
  if rg -a -q 'PRISMPM-REDACTION-CANARY' "$temporary"; then
    die 'a modeled sensitive field reached exported telemetry'
  fi
  SECRET_ROOT="$PRISMPM_SECRET_DIR" TELEMETRY_ROOT="$temporary" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(root, entry.name);
    return entry.isDirectory() ? files(item) : entry.isFile() ? [item] : [];
  });
}
const observed = Buffer.concat(files(process.env.TELEMETRY_ROOT).map((file) => fs.readFileSync(file)));
for (const file of files(process.env.SECRET_ROOT)) {
  const raw = fs.readFileSync(file);
  const trimmed = Buffer.from(raw.toString('utf8').trim());
  const forms = [raw, trimmed, Buffer.from(raw.toString('base64')),
    Buffer.from(trimmed.toString('base64'))];
  if (forms.some((secret) => secret.length >= 4 && observed.includes(secret))) {
    throw new Error(`modeled secret or its base64 encoding escaped into telemetry: ${path.relative(process.env.SECRET_ROOT, file)}`);
  }
}
for (const sensitive of ['PRISMPM-REDACTION-CANARY', '9223372036854775807',
  '-9223372036854775808', 'Café']) {
  if (observed.includes(Buffer.from(sensitive))) {
    throw new Error(`modeled operand, history, or label escaped into telemetry: ${sensitive}`);
  }
}
NODE
  rg -a -q "$request_id" "$temporary" || die 'correlated telemetry evidence is absent'
  record_json "compose-data-plane-${release,,}" "$(printf \
    '{"audit_count":1,"event_id":"%s","request_id":"%s","schema":"calculator/data-plane-acceptance/1","status":"passed"}' \
    "$event_id" "$request_id")"
  rm -rf "$temporary"
}

verify_kubernetes_data_plane() {
  local api_result=$1 request_id rejected_request_id subject event_id rejected_event_id expected_event_id event_json
  local profile_json sequence release deadline state attempt
  request_id=$(json_field concurrent_request_id <<<"$api_result")
  rejected_request_id=$(json_field rejected_request_id <<<"$api_result")
  subject=$(json_field concurrent_subject <<<"$api_result")
  release=$(json_field release <<<"$api_result")
  deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    state=$(kubectl --namespace calculator-system exec statefulset/database -- \
      psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
      "SELECT count(*) || ':' || (SELECT count(*) FROM command_outbox WHERE event_id IN (SELECT event_id FROM command_audit)) FROM command_history WHERE request_id = '$request_id';")
    test "$state" = 1:1 && break
    sleep 1
  done
  test "$state" = 1:1 || die 'Kind history/outbox/audit transaction did not converge'
  event_id=$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT event_id FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$request_id';")
  expected_event_id=$(printf '%s\0%s' "$subject" "$request_id" | sha256sum | cut -d' ' -f1)
  test "$event_id" = "$expected_event_id" ||
    die 'Kind CloudEvent identity is not the modeled subject/request SHA-256 derivation'
  event_json=$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT event::text FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$request_id';")
  sequence=$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT sequence FROM command_history WHERE request_id = '$request_id';")
  profile_json=$(kubectl --namespace calculator-system exec deployment/api -- node -e \
    'process.stdout.write(require("fs").readFileSync("/opt/prism/release/runtime-contract.json","utf8"))')
  verify_cloud_event_contract "$event_json" "$profile_json" "$event_id" \
    "$request_id" "$subject" "$sequence"
  rejected_event_id=$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT event_id FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$rejected_request_id';")
  expected_event_id=$(printf '%s\0%s' "$subject" "$rejected_request_id" | sha256sum | cut -d' ' -f1)
  test "$rejected_event_id" = "$expected_event_id" ||
    die 'Kind rejected CloudEvent identity is not the modeled subject/request SHA-256 derivation'
  event_json=$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT event::text FROM command_outbox o JOIN command_history h USING(sequence) WHERE h.request_id = '$rejected_request_id';")
  sequence=$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT sequence FROM command_history WHERE request_id = '$rejected_request_id';")
  verify_cloud_event_contract "$event_json" "$profile_json" "$rejected_event_id" \
    "$rejected_request_id" "$subject" "$sequence"
  test "$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM command_outbox WHERE event_id='$rejected_event_id';")" = 1 ||
    die 'Kind rejected calculation did not produce exactly one modeled outbox fact'
  deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    state=$(kubectl --namespace calculator-system exec statefulset/database -- \
      psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
      "SELECT published || ':' || (SELECT count(*) FROM command_audit WHERE event_id='$rejected_event_id') FROM command_outbox WHERE event_id='$rejected_event_id';")
    test "$state" = true:1 && break
    sleep 1
  done
  test "$state" = true:1 || die 'Kind rejected calculation outbox fact did not publish and audit once'
  for attempt in 1 2; do
    kubectl --namespace calculator-system exec statefulset/database -- \
      psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
      "UPDATE command_outbox SET published=false, published_at=NULL WHERE event_id='$event_id';" >/dev/null
    deadline=$((SECONDS + 20))
    while (( SECONDS < deadline )); do
      state=$(kubectl --namespace calculator-system exec statefulset/database -- \
        psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
        "SELECT (SELECT published FROM command_outbox WHERE event_id='$event_id') || ':' || (SELECT count(*) FROM command_audit WHERE event_id='$event_id');")
      test "$state" = true:1 && break
      sleep 1
    done
    test "$state" = true:1 ||
      die "Kind outbox retry $attempt did not publish once and remain audit-deduplicated"
  done
  record_json "kind-data-plane-${release,,}" "$(printf \
    '{\"audit_count\":1,\"event_id\":\"%s\",\"request_id\":\"%s\",\"schema\":\"calculator/data-plane-acceptance/1\",\"status\":\"passed\"}' \
    "$event_id" "$request_id")"
}

compose_logical_digest() {
  local target=$1 database_container
  database_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=database' --format '{{.ID}}')
  test -n "$database_container" || die "database container is absent for $target logical digest"
  docker exec "$database_container" psql -U calculator -d calculator -At \
    -v ON_ERROR_STOP=1 -c \
    "SELECT json_agg(row_to_json(value) ORDER BY value.sequence)::text FROM (SELECT * FROM command_history) value; SELECT json_agg(row_to_json(value) ORDER BY value.sequence)::text FROM (SELECT * FROM command_outbox) value; SELECT json_agg(row_to_json(value) ORDER BY value.event_id)::text FROM (SELECT * FROM command_audit) value;" |
    sha256sum | cut -d' ' -f1
}

kubernetes_logical_digest() {
  kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT json_agg(row_to_json(value) ORDER BY value.sequence)::text FROM (SELECT * FROM command_history) value; SELECT json_agg(row_to_json(value) ORDER BY value.sequence)::text FROM (SELECT * FROM command_outbox) value; SELECT json_agg(row_to_json(value) ORDER BY value.event_id)::text FROM (SELECT * FROM command_audit) value;" |
    sha256sum | cut -d' ' -f1
}

load_releases() {
  if test -n "${CALCULATOR_RELEASE_A:-}" && test -n "${CALCULATOR_RELEASE_B:-}"; then
    : # Protected CI supplies exact already-built digest references.
  else
    if test ! -f .prism/repository-evidence/releases.env; then
      ./scripts/build.sh
    fi
    # This file is generated from validated PrismPM JSON fields by build.sh.
    # shellcheck disable=SC1091
    source .prism/repository-evidence/releases.env
  fi
  : "${CALCULATOR_RELEASE_A:?}" "${CALCULATOR_RELEASE_B:?}"
  for reference in "$CALCULATOR_RELEASE_A" "$CALCULATOR_RELEASE_B"; do
    if ! prismpm --json inspect "$reference" >/dev/null 2>&1; then
      prismpm --json pull "$reference" >/dev/null
    fi
  done
}

require_published_releases() {
  : "${CALCULATOR_RELEASE_A:?roundtrip acceptance requires the published release-A digest reference}"
  : "${CALCULATOR_RELEASE_B:?roundtrip acceptance requires the published release-B digest reference}"
  for reference in "$CALCULATOR_RELEASE_A" "$CALCULATOR_RELEASE_B"; do
    [[ "$reference" =~ ^ghcr\.io/uor-foundation/calculator-system@sha256:[0-9a-f]{64}$ ]] ||
      die "roundtrip acceptance requires an exact published GHCR reference: $reference"
  done
}

wait_for_not_ready() {
  local release=$1 target=$2 description=$3
  local observed deadline
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if observed=$(prismpm --json status "$release" --target "$target") &&
      test "$(json_field ready <<<"$observed")" = false; then
      printf '%s\n' "$observed"
      return 0
    fi
    sleep 1
  done
  die "$description was not detected within 60 seconds"
}

pages_acceptance() {
  local base=${CALCULATOR_PAGES_URL:-https://uor-foundation.github.io/calculator-example}
  local commit publication
  if test "$mode" = --baseline-input; then
    node scripts/verify-baseline.mjs --require-input-ready --live
  elif test "$mode" = --projection-bootstrap; then
    node scripts/verify-baseline.mjs --require-projection-bootstrap
  else
    node scripts/verify-baseline.mjs --require-sealed --live
  fi
  BASE_URL="$base" npx --no-install playwright test
  commit=${CALCULATOR_PAGES_COMMIT:-$(git -c "safe.directory=$project_root" rev-parse HEAD)}
  publication=$(node scripts/verify-pages-publication.mjs "$base" "$commit")
  record_json pages-publication "$publication"
  printf '%s\n' "$publication"
}

compose_acceptance() {
  load_releases
  prepare_secrets
  local target=compose-local restore_target=compose-restore
  local status drift backup snapshot plan_a plan_b logical_before logical_after
  local deployed restored_retired run_stdout run_stderr run_process run_result deadline supervised=false

  # Exercise the foreground supervision contract itself: a real signal must
  # produce generated reverse-dependency shutdown and leave no managed
  # process. This is distinct from the later authorized retirement gate.
  run_stdout=$(mktemp /tmp/calculator-run.XXXXXX)
  run_stderr=$(mktemp /tmp/calculator-run-stderr.XXXXXX)
  prismpm --json run "$CALCULATOR_RELEASE_A" --target "$target" \
    >"$run_stdout" 2>"$run_stderr" &
  run_process=$!
  deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if test "$(docker ps --filter "label=com.docker.compose.project=$target" -q | wc -l)" -gt 0 &&
      prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null 2>&1; then
      supervised=true
      break
    fi
    kill -0 "$run_process" 2>/dev/null || {
      wait "$run_process" || true
      die "foreground run exited before supervision: $(<"$run_stderr")"
    }
    sleep 1
  done
  test "$supervised" = true || {
    kill -INT "$run_process" 2>/dev/null || true
    wait "$run_process" 2>/dev/null || true
    die 'foreground run never reached supervised state'
  }
  kill -INT "$run_process"
  if ! wait "$run_process"; then
    die "foreground run failed during supervised shutdown: $(<"$run_stderr")"
  fi
  run_result=$(<"$run_stdout")
  test "$(json_field status <<<"$run_result")" = stopped &&
    test "$(json_field shutdown <<<"$run_result")" = compose-reverse-dependency-graceful ||
    die 'foreground run did not report generated reverse-dependency shutdown'
  test "$(docker ps --all --filter "label=com.docker.compose.project=$target" -q | wc -l)" -eq 0 ||
    die 'foreground run shutdown left managed processes'
  record_json compose-reverse-shutdown "$run_result"
  rm "$run_stdout" "$run_stderr"

  plan_a=$(prismpm --json plan "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field plan_digest <<<"$plan_a")" = \
    "$(prismpm --json plan "$CALCULATOR_RELEASE_A" --target "$target" | json_field plan_digest)" ||
    die 'Compose plan is not deterministic against identical observed state'
  deployed=$(prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_a")")
  require_deployment_checks "$deployed" \
    post-deployment-acceptance:contract:passed \
    opentelemetry-receipt-redaction:telemetry:passed \
    modeled-slo-measurements:slo:measured
  require_no_deployment_check "$deployed" pre-deployment-logical-backup
  record_json compose-deploy-a "$deployed"
  expect_prismpm_failure compose-stale-plan PP7201 \
    prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" \
      --plan "$(json_field plan_digest <<<"$plan_a")"
  status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$status")" = true || die 'release A is not ready'
  api_acceptance_a=$(production_api_acceptance A compose-api-a)
  verify_compose_data_plane "$target" "$api_acceptance_a"
  logical_before=$(compose_logical_digest "$target")
  expect_prismpm_failure release-a-has-no-contract PP7601 \
    prismpm --json finalize-contract "$CALCULATOR_RELEASE_A" --target "$target" --authorized

  backup=$(prismpm --json backup "$CALCULATOR_RELEASE_A" --target "$target")
  record_json compose-backup "$backup"
  snapshot=$(json_field snapshot_digest <<<"$backup")
  # A restored target publishes the same modeled host port, so retire the
  # source target before proving the distinct clean target.
  prismpm --json destroy "$CALCULATOR_RELEASE_A" --target "$target" --authorized >/dev/null
  restored=$(prismpm --json restore "$CALCULATOR_RELEASE_A" --target "$target" \
    --restore-target "$restore_target" \
    --backup ".prism/backups/$target/${snapshot#sha256:}.json")
  record_json compose-restore "$restored"
  logical_after=$(compose_logical_digest "$restore_target")
  test "$logical_after" = "$logical_before" || die 'clean-target restore changed logical database content'
  production_api_acceptance A compose-restore-api-a >/dev/null
  record_json compose-restore-view-a "$(CALCULATOR_EXPECTED_RELEASE=A \
    node scripts/accept-production-view.mjs)"
  restored_retired=$(prismpm --json destroy "$CALCULATOR_RELEASE_A" \
    --target "$restore_target" --authorized)
  record_json compose-restored-target-retirement "$restored_retired"
  test "$(docker ps --all --filter "label=com.docker.compose.project=$restore_target" -q | wc -l)" -eq 0 ||
    die 'Compose restored-target retirement left managed processes'

  plan_a=$(prismpm --json plan "$CALCULATOR_RELEASE_A" --target "$target")
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_a")" >/dev/null

  api_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=api' --format '{{.ID}}')
  test -n "$api_container" || die 'modeled API container is absent'
  docker stop "$api_container" >/dev/null
  drift=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field drift <<<"$drift")" = managed || die 'stopped workload did not produce managed drift'
  record_json compose-drift "$drift"
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null

  for dependency in database issuer telemetry; do
    dependency_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
      --filter "label=com.docker.compose.service=$dependency" --format '{{.ID}}')
    test -n "$dependency_container" || die "modeled $dependency container is absent"
    docker stop "$dependency_container" >/dev/null
    outage=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
    test "$(json_field ready <<<"$outage")" = false ||
      die "$dependency outage was not detected"
    record_json "compose-$dependency-outage" "$outage"
    prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null
  done

  database_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=database' --format '{{.ID}}')
  network=$(docker inspect "$database_container" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(Object.keys(JSON.parse(s)[0].NetworkSettings.Networks)[0]??""))')
  test -n "$network" || die 'database network is absent'
  docker network disconnect "$network" "$database_container"
  network_outage=$(wait_for_not_ready "$CALCULATOR_RELEASE_A" "$target" \
    'modeled network interruption')
  record_json compose-network-interruption "$network_outage"
  docker network connect "$network" "$database_container"
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null

  credential_file=$PRISMPM_SECRET_DIR/calculator/broker-password
  credential_copy=$PRISMPM_SECRET_DIR/broker-password.acceptance-copy
  cp "$credential_file" "$credential_copy"
  openssl rand -hex 32 >"$credential_file"
  docker compose --project-name "$target" \
    --file .prism/targets/compose-local/projection.json restart api audit-worker >/dev/null
  credential_outage=$(wait_for_not_ready "$CALCULATOR_RELEASE_A" "$target" \
    'expired workload credential')
  record_json compose-expired-credential "$credential_outage"
  cp "$credential_copy" "$credential_file"
  rm "$credential_copy"
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null

  oidc_key_file=$PRISMPM_SECRET_DIR/calculator/oidc-signing-key
  oidc_key_copy=$PRISMPM_SECRET_DIR/oidc-signing-key.acceptance-copy
  cp "$oidc_key_file" "$oidc_key_copy"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$oidc_key_file" >/dev/null 2>&1
  docker compose --project-name "$target" \
    --file .prism/targets/compose-local/projection.json up --detach --wait \
    --no-build --force-recreate issuer >/dev/null
  production_api_acceptance A compose-oidc-key-rotation-a >/dev/null
  cp "$oidc_key_copy" "$oidc_key_file"
  rm "$oidc_key_copy"
  record_json compose-oidc-key-rotation \
    "$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")"

  api_before=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=api' --format '{{.ID}}' | sort)
  test -n "$api_before" || die 'API processes are absent before restart acceptance'
  api_victim=$(head -n 1 <<<"$api_before")
  docker kill "$api_victim" >/dev/null
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    api_after=$(docker ps --filter "label=com.docker.compose.project=$target" \
      --filter 'label=com.docker.compose.service=api' --format '{{.ID}}' | sort)
    if test "$(wc -l <<<"$api_after")" -eq 2 && test "$api_after" != "$api_before"; then
      break
    fi
    sleep 1
  done
  test "$api_after" != "$api_before" || die 'modeled API process did not restart'
  record_json compose-process-restart "$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")"

  broker_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=broker' --format '{{.ID}}')
  test -n "$broker_container" || die 'modeled broker container is absent'
  docker stop "$broker_container" >/dev/null
  outage=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$outage")" = false || die 'dependency outage was not detected'
  record_json compose-dependency-outage "$outage"
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null

  plan_b=$(prismpm --json plan "$CALCULATOR_RELEASE_B" --target "$target")
  old_migrate=$(docker ps --all --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=migrate' --format '{{.ID}}' | head -n 1)
  (
    deadline=$((SECONDS + 30))
    while (( SECONDS < deadline )); do
      candidate=$(docker ps --filter "label=com.docker.compose.project=$target" \
        --filter 'label=com.docker.compose.service=migrate' --format '{{.ID}}' | head -n 1)
      if test -n "$candidate" && test "$candidate" != "$old_migrate"; then
        docker kill "$candidate" >/dev/null 2>&1 || true
        exit 0
      fi
      sleep 0.05
    done
    exit 1
  ) &
  injector=$!
  if prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_b")" \
    >.prism/repository-evidence/failed-b-rollout.stdout.json \
    2>.prism/repository-evidence/failed-b-rollout.stderr.json; then
    wait "$injector" || true
    die 'injected failed B rollout was accepted'
  fi
  wait "$injector" || die 'failed-rollout fault was not injected into the real migration job'
  status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$status")" = true || die 'failed B rollout did not restore ready release A'
  record_json compose-automatic-rollback "$status"

  plan_b=$(prismpm --json plan "$CALCULATOR_RELEASE_B" --target "$target")
  deployed=$(prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_b")")
  require_deployment_checks "$deployed" \
    post-deployment-acceptance:contract:passed \
    opentelemetry-receipt-redaction:telemetry:passed \
    modeled-slo-measurements:slo:measured \
    pre-deployment-logical-backup:backup:passed
  require_predeployment_backup "$deployed" "$CALCULATOR_RELEASE_A" "$target"
  record_json compose-forward-recovery-b "$deployed"
  api_acceptance_b=$(production_api_acceptance B compose-api-b)
  verify_compose_data_plane "$target" "$api_acceptance_b"
  record_json production-view "$(CALCULATOR_VIEW_FAULT_TARGET=compose \
    CALCULATOR_VIEW_COMPOSE_PROJECT="$target" \
    node scripts/accept-production-view.mjs)"

  previous_tls=$(sha256sum "$PRISMPM_SECRET_DIR/calculator/tls-certificate" | cut -d' ' -f1)
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=calculator.local' \
    -keyout "$PRISMPM_SECRET_DIR/tls-rotated.key" \
    -out "$PRISMPM_SECRET_DIR/tls-rotated.crt" >/dev/null 2>&1
  node -e \
    'const fs=require("fs");process.stdout.write(JSON.stringify({cert:fs.readFileSync(process.argv[1],"utf8"),key:fs.readFileSync(process.argv[2],"utf8")}))' \
    "$PRISMPM_SECRET_DIR/tls-rotated.crt" "$PRISMPM_SECRET_DIR/tls-rotated.key" \
    >"$PRISMPM_SECRET_DIR/calculator/tls-certificate"
  rotated_tls=$(sha256sum "$PRISMPM_SECRET_DIR/calculator/tls-certificate" | cut -d' ' -f1)
  test "$rotated_tls" != "$previous_tls" || die 'TLS secret rotation did not change the secret'
  docker compose --project-name "$target" \
    --file .prism/targets/compose-local/projection.json restart browser >/dev/null
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if docker compose --project-name "$target" \
      --file .prism/targets/compose-local/projection.json ps --format json browser |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const rows=s.trim().split("\n").filter(Boolean).flatMap(x=>{const v=JSON.parse(x);return Array.isArray(v)?v:[v]});process.exit(rows.length>0&&rows.every(x=>(x.Health??x.health)==="healthy")?0:1)})'; then
      break
    fi
    sleep 1
  done
  node scripts/accept-production-view.mjs >/dev/null
  record_json compose-secret-rotation "$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")"

  resource_container=$(docker ps --filter "label=com.docker.compose.project=$target" \
    --filter 'label=com.docker.compose.service=api' --format '{{.ID}}' | head -n 1)
  test -n "$resource_container" || die 'API container is absent for resource-exhaustion acceptance'
  if timeout 20 docker exec "$resource_container" node -e \
    'const value=Buffer.alloc(1024*1024*1024,1);process.stdout.write(String(value[value.length-1]))' \
    >/dev/null 2>&1; then
    die 'the modeled API memory limit admitted a one-GiB allocation'
  fi
  resource_status=$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")
  test "$(json_field ready <<<"$resource_status")" = true ||
    die 'bounded resource exhaustion damaged the replicated API service'
  record_json compose-resource-exhaustion "$resource_status"
  rolled_back=$(prismpm --json rollback "$CALCULATOR_RELEASE_A" --target "$target")
  record_json compose-rollback "$rolled_back"

  # The expand phase preserves A-compatible binary rollback. The separately
  # authorized contract phase advances the compatibility floor to B.
  prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" >/dev/null
  expect_prismpm_failure unauthorized-contract PP7701 \
    prismpm --json finalize-contract "$CALCULATOR_RELEASE_B" --target "$target"
  finalized=$(prismpm --json finalize-contract "$CALCULATOR_RELEASE_B" \
    --target "$target" --authorized)
  record_json compose-contract-finalized "$finalized"
  finalized_again=$(prismpm --json finalize-contract "$CALCULATOR_RELEASE_B" \
    --target "$target" --authorized)
  test "$(json_field release_digest <<<"$finalized_again")" = \
    "$(json_field release_digest <<<"$finalized")" ||
    die 'the modeled contract migration was not idempotent'
  record_json compose-contract-finalized-repeat "$finalized_again"

  # A direct deployment or rollback after the B floor is finalized is a
  # destructive downgrade and must be refused without target mutation.
  expect_prismpm_failure unsafe-downgrade PP7601 \
    prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target"
  expect_prismpm_failure unsafe-rollback PP7601 \
    prismpm --json rollback "$CALCULATOR_RELEASE_A" --target "$target"
  final_status=$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")
  test "$(json_field ready <<<"$final_status")" = true || die 'final B release is not ready'
  test "$(json_field migration_phase <<<"$final_status")" = contract-finalized ||
    die 'final B compatibility floor is not recorded'
  record_json compose-final-status "$final_status"
  expect_prismpm_failure compose-unauthorized-retirement PP7701 \
    prismpm --json destroy "$CALCULATOR_RELEASE_B" --target "$target"
  retired=$(prismpm --json destroy "$CALCULATOR_RELEASE_B" --target "$target" --authorized)
  record_json compose-authorized-retirement "$retired"
  test "$(docker ps --all --filter "label=com.docker.compose.project=$target" -q | wc -l)" -eq 0 ||
    die 'Compose retirement left managed processes'
}

kind_acceptance() {
  load_releases
  prepare_secrets
  local cluster=calculator-acceptance target=kubernetes-kind
  local plan_a plan_b deployed status outage drift api_uid replacement_uid persisted_request
  local deadline api_acceptance_a api_acceptance_b view_acceptance rolled_back finalized retired
  local ingress_address ingress_url backup snapshot restored restored_retired logical_before logical_after
  local backup_marker old_migration_uid injector candidate
  local restore_target=kubernetes-kind-restore
  calculator_kubeconfig=$(mktemp /tmp/calculator-kubeconfig.XXXXXX)
  calculator_kind_config=$(mktemp /tmp/calculator-kind.XXXXXX)
  printf '%s\n' \
    'kind: Cluster' \
    'apiVersion: kind.x-k8s.io/v1alpha4' \
    'nodes:' \
    '- role: control-plane' \
    '  extraPortMappings:' \
    '  - containerPort: 443' \
    '    hostPort: 18443' \
    '    listenAddress: "0.0.0.0"' \
    '    protocol: TCP' \
    >"$calculator_kind_config"
  export KUBECONFIG=$calculator_kubeconfig
  create_kind_cluster "$cluster"
  provision_kubernetes_secrets

  plan_a=$(prismpm --json plan "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field plan_digest <<<"$plan_a")" = \
    "$(prismpm --json plan "$CALCULATOR_RELEASE_A" --target "$target" | json_field plan_digest)" ||
    die 'Kubernetes plan is not deterministic against identical observed state'
  deployed=$(prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_a")")
  require_deployment_checks "$deployed" \
    post-deployment-acceptance:contract:passed \
    opentelemetry-receipt-redaction:telemetry:passed \
    modeled-slo-measurements:slo:measured
  require_no_deployment_check "$deployed" pre-deployment-logical-backup
  record_json kind-deploy-a "$deployed"
  expect_prismpm_failure kind-stale-plan PP7201 \
    prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" \
      --plan "$(json_field plan_digest <<<"$plan_a")"
  status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$status")" = true || die 'Kind release A is not ready'
  test "$(json_field drift <<<"$status")" = none || die 'Kind release A has drift'
  record_json kind-status-a "$status"

  test "$(kubectl --namespace calculator-system get pvc \
    -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' | LC_ALL=C sort -u)" = Bound ||
    die 'modeled static persistent volumes are not bound'
  ingress_address=$(kind_ingress_address)
  ingress_url=https://calculator.local:18443
  wait_kind_ingress "$ingress_address" A
  api_acceptance_a=$(production_api_acceptance A kind-api-a "$ingress_url" "$ingress_address")
  verify_kubernetes_data_plane "$api_acceptance_a"
  view_acceptance=$(CALCULATOR_PRODUCTION_URL="$ingress_url" \
    CALCULATOR_CONNECT_ADDRESS="$ingress_address" \
    CALCULATOR_EXPECTED_RELEASE=A \
    NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/accept-production-view.mjs)
  record_json kind-view-a "$view_acceptance"

  api_uid=$(kubectl --namespace calculator-system get pods \
    -l app.kubernetes.io/name=api -o jsonpath='{.items[0].metadata.uid}')
  test -n "$api_uid" || die 'Kind API pod is absent before restart test'
  kubectl --namespace calculator-system delete pod \
    -l app.kubernetes.io/name=api --wait=true >/dev/null
  kubectl --namespace calculator-system rollout status deployment/api --timeout=120s >/dev/null
  replacement_uid=$(kubectl --namespace calculator-system get pods \
    -l app.kubernetes.io/name=api -o jsonpath='{.items[0].metadata.uid}')
  test -n "$replacement_uid" && test "$replacement_uid" != "$api_uid" ||
    die 'Kubernetes did not replace the failed API process'
  record_json kind-process-recovery \
    "$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")"

  kubectl --namespace calculator-system scale statefulset/database --replicas=0 >/dev/null
  outage=$(wait_for_not_ready "$CALCULATOR_RELEASE_A" "$target" 'Kubernetes database outage')
  record_json kind-database-outage "$outage"
  kubectl --namespace calculator-system scale statefulset/database --replicas=1 >/dev/null
  kubectl --namespace calculator-system rollout status statefulset/database --timeout=120s >/dev/null
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null
  status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$status")" = true || die 'Kind did not recover from database outage'
  persisted_request=$(json_field concurrent_request_id <<<"$api_acceptance_a")
  test "$(kubectl --namespace calculator-system exec statefulset/database -- \
    psql -U calculator -d calculator -At -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM command_history WHERE request_id='$persisted_request';")" = 1 ||
    die 'Kubernetes persistent volume lost accepted history across database restart'
  record_json kind-database-recovery "$status"

  for dependency in broker issuer telemetry; do
    case "$dependency" in
      broker|issuer|telemetry) workload=deployment ;;
    esac
    kubectl --namespace calculator-system scale "$workload/$dependency" --replicas=0 >/dev/null
    outage=$(wait_for_not_ready "$CALCULATOR_RELEASE_A" "$target" \
      "Kubernetes $dependency outage")
    record_json "kind-$dependency-outage" "$outage"
    kubectl --namespace calculator-system scale "$workload/$dependency" --replicas=1 >/dev/null
    kubectl --namespace calculator-system rollout status "$workload/$dependency" \
      --timeout=120s >/dev/null
    prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null
    status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
    test "$(json_field ready <<<"$status")" = true ||
      die "Kind did not recover from $dependency outage"
    record_json "kind-$dependency-recovery" "$status"
  done

  kubectl --namespace calculator-system delete networkpolicy dependency-database >/dev/null
  outage=$(wait_for_not_ready "$CALCULATOR_RELEASE_A" "$target" \
    'Kubernetes modeled database network interruption')
  record_json kind-network-interruption "$outage"
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null
  status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$status")" = true ||
    die 'Kind did not recover the modeled database network policy'
  record_json kind-network-recovery "$status"

  kubectl --namespace calculator-system scale deployment/api --replicas=1 >/dev/null
  drift=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field drift <<<"$drift")" = managed ||
    die 'Kubernetes replica drift was not detected'
  record_json kind-managed-drift "$drift"
  prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target" >/dev/null

  # A failed B migration must stop the rollout and leave the accepted A
  # workloads serving. Wait until the mandatory pre-deployment backup has
  # completed, then kill only the newly created B migration Job; this plants a
  # rollout failure without damaging the still-serving A dependencies.
  plan_b=$(prismpm --json plan "$CALCULATOR_RELEASE_B" --target "$target")
  backup_marker=$(mktemp /tmp/calculator-predeployment-backup.XXXXXX)
  old_migration_uid=$(kubectl --namespace calculator-system get job migrate \
    -o jsonpath='{.metadata.uid}' 2>/dev/null || true)
  (
    deadline=$((SECONDS + 90))
    while (( SECONDS < deadline )); do
      if find ".prism/backups/$target" -type f -name '*.json' \
        -newer "$backup_marker" -print -quit 2>/dev/null | grep -q .; then
        candidate=$(kubectl --namespace calculator-system get job migrate \
          -o jsonpath='{.metadata.uid}' 2>/dev/null || true)
        if test -n "$candidate" && test "$candidate" != "$old_migration_uid"; then
          kubectl --namespace calculator-system delete job migrate --wait=false >/dev/null
          exit 0
        fi
      fi
      sleep 0.05
    done
    exit 1
  ) &
  injector=$!
  if prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_b")" \
    >.prism/repository-evidence/kind-failed-b-rollout.stdout.json \
    2>.prism/repository-evidence/kind-failed-b-rollout.stderr.json; then
    wait "$injector" || true
    rm "$backup_marker"
    die 'Kind accepted release B after its migration Job was killed'
  fi
  wait "$injector" || die 'Kind failed-rollout injection did not follow the pre-deployment backup'
  rm "$backup_marker"
  status=$(prismpm --json status "$CALCULATOR_RELEASE_A" --target "$target")
  test "$(json_field ready <<<"$status")" = true ||
    die 'failed Kind release-B rollout did not preserve ready release A'
  record_json kind-automatic-rollback "$status"

  plan_b=$(prismpm --json plan "$CALCULATOR_RELEASE_B" --target "$target")
  mixed_versions=$(mktemp /tmp/calculator-mixed-versions.XXXXXX)
  deploy_result=$(mktemp /tmp/calculator-kind-deploy-b.XXXXXX)
  prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" \
    --plan "$(json_field plan_digest <<<"$plan_b")" >"$deploy_result" &
  deploy_process=$!
  while kill -0 "$deploy_process" 2>/dev/null; do
    observed_release=$(curl --insecure --silent --show-error --fail \
      --resolve "calculator.local:18443:$ingress_address" "$ingress_url/app.js" \
      2>/dev/null || true)
    sed -n 's/.*"release":"\([AB]\)".*/\1/p' <<<"$observed_release" >>"$mixed_versions"
    sleep 0.05
  done
  wait "$deploy_process"
  deployed=$(<"$deploy_result")
  observed_versions=$(LC_ALL=C sort -u "$mixed_versions" | tr -d '\n')
  rm "$deploy_result" "$mixed_versions"
  test "$observed_versions" = AB ||
    die "Kind rollout did not expose the required live A/B compatibility window: $observed_versions"
  require_deployment_checks "$deployed" \
    post-deployment-acceptance:contract:passed \
    opentelemetry-receipt-redaction:telemetry:passed \
    modeled-slo-measurements:slo:measured \
    pre-deployment-logical-backup:backup:passed
  require_predeployment_backup "$deployed" "$CALCULATOR_RELEASE_A" "$target"
  record_json kind-deploy-b "$deployed"
  record_json kind-mixed-version-window \
    '{"releases":["A","B"],"schema":"calculator/mixed-version-acceptance/1","status":"passed"}'
  status=$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")
  test "$(json_field ready <<<"$status")" = true || die 'Kind release B is not ready'
  test "$(json_field drift <<<"$status")" = none || die 'Kind release B has drift'
  record_json kind-status-b "$status"

  wait_kind_ingress "$ingress_address" B
  api_acceptance_b=$(production_api_acceptance B kind-api-b "$ingress_url" "$ingress_address")
  verify_kubernetes_data_plane "$api_acceptance_b"
  view_acceptance=$(CALCULATOR_PRODUCTION_URL="$ingress_url" \
    CALCULATOR_CONNECT_ADDRESS="$ingress_address" \
    CALCULATOR_EXPECTED_RELEASE=B \
    CALCULATOR_VIEW_FAULT_TARGET=kind \
    NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/accept-production-view.mjs)
  record_json kind-view-b "$view_acceptance"

  previous_tls=$(openssl s_client -connect "$ingress_address:18443" \
    -servername calculator.local </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256)
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=calculator.local' \
    -keyout "$PRISMPM_SECRET_DIR/kind-tls-rotated.key" \
    -out "$PRISMPM_SECRET_DIR/kind-tls-rotated.crt" >/dev/null 2>&1
  kubectl --namespace calculator-system create secret generic tls-certificate \
    --type kubernetes.io/tls \
    --from-file="value=$PRISMPM_SECRET_DIR/calculator/tls-certificate" \
    --from-file="tls.crt=$PRISMPM_SECRET_DIR/kind-tls-rotated.crt" \
    --from-file="tls.key=$PRISMPM_SECRET_DIR/kind-tls-rotated.key" \
    --dry-run=client --output yaml | kubectl apply -f - >/dev/null
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    rotated_tls=$(openssl s_client -connect "$ingress_address:18443" \
      -servername calculator.local </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256)
    test -n "$rotated_tls" && test "$rotated_tls" != "$previous_tls" && break
    sleep 1
  done
  test -n "$rotated_tls" && test "$rotated_tls" != "$previous_tls" ||
    die 'Kind TLS ingress did not observe the modeled secret rotation'
  CALCULATOR_PRODUCTION_URL="$ingress_url" CALCULATOR_CONNECT_ADDRESS="$ingress_address" \
    CALCULATOR_EXPECTED_RELEASE=B NODE_TLS_REJECT_UNAUTHORIZED=0 \
    node scripts/accept-production-view.mjs >/dev/null
  record_json kind-secret-rotation \
    "$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")"

  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$PRISMPM_SECRET_DIR/kind-oidc-signing-key-rotated" >/dev/null 2>&1
  kubectl --namespace calculator-system create secret generic oidc-signing-key \
    --from-file="value=$PRISMPM_SECRET_DIR/kind-oidc-signing-key-rotated" \
    --dry-run=client --output yaml | kubectl apply -f - >/dev/null
  kubectl --namespace calculator-system rollout restart deployment/issuer >/dev/null
  kubectl --namespace calculator-system rollout status deployment/issuer --timeout=120s >/dev/null
  production_api_acceptance B kind-oidc-key-rotation-b "$ingress_url" "$ingress_address" >/dev/null
  prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" >/dev/null
  record_json kind-oidc-key-rotation \
    "$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")"

  resource_pod=$(kubectl --namespace calculator-system get pods \
    -l app.kubernetes.io/name=api -o jsonpath='{.items[0].metadata.name}')
  test -n "$resource_pod" || die 'Kind API pod is absent for resource-exhaustion acceptance'
  if timeout 20 kubectl --namespace calculator-system exec "$resource_pod" -- node -e \
    'const value=Buffer.alloc(1024*1024*1024,1);process.stdout.write(String(value[value.length-1]))' \
    >/dev/null 2>&1; then
    die 'the modeled Kubernetes API memory limit admitted a one-GiB allocation'
  fi
  kubectl --namespace calculator-system rollout status deployment/api --timeout=120s >/dev/null
  status=$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")
  test "$(json_field ready <<<"$status")" = true ||
    die 'bounded Kubernetes resource exhaustion damaged the replicated API service'
  record_json kind-resource-exhaustion "$status"

  rolled_back=$(prismpm --json rollback "$CALCULATOR_RELEASE_A" --target "$target")
  record_json kind-rollback-a "$rolled_back"
  prismpm --json deploy "$CALCULATOR_RELEASE_B" --target "$target" >/dev/null
  expect_prismpm_failure kind-unauthorized-contract PP7701 \
    prismpm --json finalize-contract "$CALCULATOR_RELEASE_B" --target "$target"
  finalized=$(prismpm --json finalize-contract "$CALCULATOR_RELEASE_B" \
    --target "$target" --authorized)
  record_json kind-contract-finalized "$finalized"
  expect_prismpm_failure kind-unsafe-downgrade PP7601 \
    prismpm --json deploy "$CALCULATOR_RELEASE_A" --target "$target"
  expect_prismpm_failure kind-unsafe-rollback PP7601 \
    prismpm --json rollback "$CALCULATOR_RELEASE_A" --target "$target"
  status=$(prismpm --json status "$CALCULATOR_RELEASE_B" --target "$target")
  test "$(json_field ready <<<"$status")" = true || die 'Kind final B release is not ready'
  test "$(json_field migration_phase <<<"$status")" = contract-finalized ||
    die 'Kind final B compatibility floor is not recorded'
  record_json kind-final-status "$status"

  # Prove a logical backup against the final accepted schema, then restore it
  # into a genuinely clean Kubernetes target: a newly created cluster with no
  # retained PV bytes or API objects from the source deployment.
  logical_before=$(kubernetes_logical_digest)
  backup=$(prismpm --json backup "$CALCULATOR_RELEASE_B" --target "$target")
  record_json kind-backup "$backup"
  snapshot=$(json_field snapshot_digest <<<"$backup")
  expect_prismpm_failure kind-unauthorized-retirement PP7701 \
    prismpm --json destroy "$CALCULATOR_RELEASE_B" --target "$target"
  retired=$(prismpm --json destroy "$CALCULATOR_RELEASE_B" --target "$target" --authorized)
  record_json kind-authorized-retirement "$retired"
  test "$(kubectl --namespace calculator-system get deployments,statefulsets,jobs \
    --no-headers 2>/dev/null | wc -l)" -eq 0 || die 'Kind retirement left managed workloads'
  kind delete cluster --name "$cluster" >/dev/null
  create_kind_cluster "$cluster"
  provision_kubernetes_secrets
  restored=$(prismpm --json restore "$CALCULATOR_RELEASE_B" --target "$target" \
    --restore-target "$restore_target" \
    --backup ".prism/backups/$target/${snapshot#sha256:}.json")
  record_json kind-clean-target-restore "$restored"
  test "$(kubectl --namespace calculator-system get pvc \
    -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' | LC_ALL=C sort -u)" = Bound ||
    die 'clean-target restore did not bind the modeled static persistent volumes'
  logical_after=$(kubernetes_logical_digest)
  test "$logical_after" = "$logical_before" ||
    die 'clean Kubernetes restore changed logical database content'
  ingress_address=$(kind_ingress_address)
  wait_kind_ingress "$ingress_address" B
  production_api_acceptance B kind-restored-api-b "$ingress_url" "$ingress_address" >/dev/null
  view_acceptance=$(CALCULATOR_PRODUCTION_URL="$ingress_url" \
    CALCULATOR_CONNECT_ADDRESS="$ingress_address" CALCULATOR_EXPECTED_RELEASE=B \
    NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/accept-production-view.mjs)
  record_json kind-restored-view-b "$view_acceptance"
  restored_retired=$(prismpm --json destroy "$CALCULATOR_RELEASE_B" \
    --target "$restore_target" --authorized)
  record_json kind-restored-target-retirement "$restored_retired"
  test "$(kubectl --namespace calculator-system get deployments,statefulsets,jobs \
    --no-headers 2>/dev/null | wc -l)" -eq 0 ||
    die 'Kind restored-target retirement left managed workloads'
}

conformance_acceptance() {
  load_releases
  local reference result transcript attached suffix result_path
  for entry in "A:$CALCULATOR_RELEASE_A" "B:$CALCULATOR_RELEASE_B"; do
    suffix=${entry%%:*}
    reference=${entry#*:}
    result=$(prismpm --json conformance "$reference")
    test "$(json_field feature_count <<<"$result")" = 147 ||
      die "release $suffix conformance did not execute all public features"
    test "$(json_field diagnostic_count <<<"$result")" = 83 ||
      die "release $suffix conformance did not execute all public diagnostics"
    record_json "conformance-${suffix,,}" "$result"
    result_path=".prism/repository-evidence/conformance-${suffix,,}.json"
    node scripts/verify-conformance-result.mjs "$result_path" "$reference" \
      prismpm.lock "$PRISMPM_SDK_INVENTORY" >/dev/null
    transcript=$(json_field transcript_path <<<"$result")
    test -f "$transcript" || die "release $suffix conformance transcript is absent"

    # Exercise the independently callable attachment boundary as well as the
    # public runner. It must validate and attach the exact canonical transcript
    # emitted by the SDK runner without replacing any Calculator scenario.
    attached=$(prismpm --json acceptance "$reference" --input "$transcript")
    test "$(json_field status <<<"$attached")" = accepted ||
      die "release $suffix production acceptance attachment was rejected"
    test "$(json_field release_digest <<<"$attached")" = "${reference##*@}" ||
      die "release $suffix acceptance result names a different release"
    test "$(json_field sdk_digest <<<"$attached")" = "$(json_field sdk_digest <<<"$result")" ||
      die "release $suffix acceptance result names a different SDK"
    test "$(json_field acceptance_digest <<<"$attached")" = \
      "$(json_field transcript_digest <<<"$result")" ||
      die "release $suffix attachment names different transcript bytes"
    test "$(json_field referrer_digest <<<"$attached")" = \
      "$(json_field referrer_digest <<<"$result")" ||
      die "release $suffix attachment names a different acceptance referrer"
    record_json "production-acceptance-${suffix,,}" "$attached"
  done
}

roundtrip_acceptance() {
  require_published_releases
  load_releases
  conformance_acceptance
  pushed=$(prismpm --json push "$CALCULATOR_RELEASE_A")
  record_json registry-push-a "$pushed"
  pushed=$(prismpm --json push "$CALCULATOR_RELEASE_B")
  record_json registry-push-b "$pushed"
  local clean
  calculator_pull_root=$(mktemp -d /tmp/calculator-pull.XXXXXX)
  clean=$calculator_pull_root
  cp prismpm.lock standards.lock prismpm.toml "$clean/"
  prismpm --project "$clean" --json pull "$CALCULATOR_RELEASE_A" >"$clean/pull-a.json"
  prismpm --project "$clean" --json verify-release "$CALCULATOR_RELEASE_A" >"$clean/verify-release-a.json"
  prismpm --project "$clean" --json inspect "$CALCULATOR_RELEASE_A" >"$clean/inspect-a.json"
  prismpm --project "$clean" --json pull "$CALCULATOR_RELEASE_B" >"$clean/pull-b.json"
  prismpm --project "$clean" --json verify-release "$CALCULATOR_RELEASE_B" >"$clean/verify-release-b.json"
  prismpm --project "$clean" --json inspect "$CALCULATOR_RELEASE_B" >"$clean/inspect-b.json"
  for release in a b; do
    test "$(json_field verified <"$clean/verify-release-$release.json")" = true ||
      die "clean-cache release-$release signature closure was not cryptographically verified"
    test "$(json_field release_signatures <"$clean/verify-release-$release.json")" = 1 ||
      die "clean-cache release-$release does not have exactly one release signature"
    test "$(json_field promotion_signatures <"$clean/verify-release-$release.json")" = 2 ||
      die "clean-cache release-$release does not have the complete promotion chain"
    test "$(json_field deployment_evidence_signatures <"$clean/verify-release-$release.json")" = 1 ||
      die "clean-cache release-$release does not have exactly one complete evidence signature"
    test "$(json_field status <"$clean/verify-release-$release.json")" = accepted ||
      die "clean-cache release-$release is not accepted"
  done
  cp "$clean"/*.json "$(evidence_dir)/"
  expect_prismpm_failure registry-outage PP6201 \
    prismpm --project "$clean" --json pull \
      "registry-outage.invalid/uor/calculator-system@sha256:$(printf '0%.0s' {1..64})"
  rm -rf "$clean"
  calculator_pull_root=
}

case "$suite" in
  pages) pages_acceptance ;;
  compose) compose_acceptance ;;
  conformance) conformance_acceptance ;;
  kind) kind_acceptance ;;
  roundtrip) roundtrip_acceptance ;;
  system)
    compose_acceptance
    kind_acceptance
    conformance_acceptance
    ;;
  all)
    require_published_releases
    pages_acceptance
    compose_acceptance
    kind_acceptance
    conformance_acceptance
    roundtrip_acceptance
    ;;
esac
