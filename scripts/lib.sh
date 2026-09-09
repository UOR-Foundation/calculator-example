#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

die() {
  printf 'calculator acceptance: %s\n' "$*" >&2
  exit 1
}

require_sdk_environment() {
  test -n "${PRISMPM_SDK_INVENTORY:-}" ||
    die 'run this command in the prismpm.lock SDK devcontainer'
  test -f "$PRISMPM_SDK_INVENTORY" || die 'SDK inventory is absent'
  test "$PRISMPM_SDK_INVENTORY" = /opt/prismpm/share/inventory.json ||
    die 'the SDK inventory is not at its immutable image path'
  test "$(command -v prismpm)" = /usr/local/bin/prismpm ||
    die 'a host or project PrismPM executable shadows the SDK binary'
  SDK_INVENTORY="$PRISMPM_SDK_INVENTORY" node - \
    bash cargo curl docker git just kind kubectl lake lean lexlean node npm npx \
    openssl prismpm rustc sha256sum wasm-tools <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const inventory = JSON.parse(fs.readFileSync(process.env.SDK_INVENTORY, 'utf8'));
const rows = (inventory.artifacts ?? []).filter((row) => row.id === 'prismpm');
if (rows.length !== 1 || rows[0].kind !== 'binary' ||
    !/^sha256:[0-9a-f]{64}$/.test(rows[0].digest ?? '')) process.exit(1);
const observed = `sha256:${crypto.createHash('sha256')
  .update(fs.readFileSync('/usr/local/bin/prismpm')).digest('hex')}`;
if (observed !== rows[0].digest) process.exit(1);

// A repository gate must not succeed by finding a host-mounted or
// project-supplied executable earlier on PATH. The SDK inventory binds both
// the canonical path and bytes of every substantive command used below.
const commands = new Map((inventory.commands ?? []).map((row) => [row.command, row]));
const resolveCommand = (command) => {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {}
  }
  throw new Error(`required SDK command is absent: ${command}`);
};
for (const command of process.argv.slice(2)) {
  const row = commands.get(command);
  if (!row || typeof row.executable !== 'string' ||
      !/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) {
    throw new Error(`SDK inventory does not bind command ${command}`);
  }
  const expected = fs.realpathSync(row.executable);
  const actual = resolveCommand(command);
  if (actual !== expected) {
    throw new Error(`${command} resolves outside the SDK inventory: ${actual}`);
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex');
  if (digest !== row.sha256) {
    throw new Error(`${command} bytes differ from the SDK inventory`);
  }
}

for (const [command, executable] of [
  ['docker-buildx', '/usr/local/libexec/docker/cli-plugins/docker-buildx'],
  ['docker-compose', '/usr/local/libexec/docker/cli-plugins/docker-compose'],
]) {
  const row = commands.get(command);
  if (!row || row.executable !== executable ||
      !/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) {
    throw new Error(`SDK inventory does not bind Docker CLI plugin ${command}`);
  }
  const actual = fs.realpathSync(executable);
  if (actual !== executable) {
    throw new Error(`${command} resolves through an unexpected link: ${actual}`);
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex');
  if (digest !== row.sha256) {
    throw new Error(`${command} bytes differ from the SDK inventory`);
  }
}
const dockerConfig = process.env.DOCKER_CONFIG ??
  path.join(process.env.HOME ?? '', '.docker');
const userPlugins = path.join(dockerConfig, 'cli-plugins');
if (fs.existsSync(userPlugins)) {
  throw new Error(`host/user Docker CLI plugins are mounted into the SDK: ${userPlugins}`);
}

const manifestPath = path.join(process.cwd(), '.prism', 'sdk', 'stdlib-manifest.json');
const inputRoot = path.join(process.cwd(), '.prism', 'sdk', 'inputs');
const sourceArchive = path.join(path.dirname(process.env.SDK_INVENTORY), 'stdlib-sources.tar');
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
  value !== null && typeof value === 'object' ?
    `{${Object.keys(value).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` :
    JSON.stringify(value);
if (manifestBytes.toString('utf8') !== canonical(manifest) ||
    manifest.schema !== 'prismpm/sdk-inputs/1' ||
    !/^[0-9a-f]{64}$/.test(manifest.archive_sha256 ?? '') ||
    !Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error('installed SDK input manifest is malformed or noncanonical');
}
const archiveDigest = crypto.createHash('sha256').update(fs.readFileSync(sourceArchive)).digest('hex');
if (archiveDigest !== manifest.archive_sha256) {
  throw new Error('installed model inputs name a different SDK source archive');
}
const actualFiles = [];
const walk = (directory, relative = '') => {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
    const child = path.join(directory, entry.name);
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`SDK input is a symlink: ${childRelative}`);
    if (entry.isDirectory()) walk(child, childRelative);
    else if (entry.isFile()) actualFiles.push({
      path: childRelative,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex'),
    });
    else throw new Error(`SDK input is not a regular file: ${childRelative}`);
  }
};
walk(inputRoot);
if (canonical(actualFiles) !== canonical(manifest.files)) {
  throw new Error('installed SDK model inputs are stale, missing, extra, or modified');
}
NODE
  docker buildx version >/dev/null
  docker compose version >/dev/null
  prismpm lock check >/dev/null
}

require_sdk() {
  require_sdk_environment
  node scripts/verify-baseline.mjs --require-sealed >/dev/null
}

json_field() {
  local field=$1
  node -e \
    'let input="";process.stdin.on("data",(chunk)=>input+=chunk).on("end",()=>{const value=JSON.parse(input)[process.argv[1]];if(value===undefined)process.exit(2);process.stdout.write(String(value))})' \
    "$field"
}

digest_reference() {
  local repository=$1
  local result=$2
  local digest
  digest=$(json_field release_digest <<<"$result")
  printf '%s@%s\n' "$repository" "$digest"
}

release_repository() {
  printf '%s\n' "${CALCULATOR_RELEASE_REPOSITORY:-ghcr.io/uor-foundation/calculator-system}"
}

evidence_dir() {
  mkdir -p .prism/repository-evidence
  printf '%s\n' .prism/repository-evidence
}

record_json() {
  local name=$1
  local value=$2
  local directory
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,127}$ ]] || die 'evidence name is malformed'
  directory=$(evidence_dir)
  printf '%s' "$value" | node -e '
    const fs = require("node:fs");
    let input = "";
    const sorted = (value) => Array.isArray(value) ? value.map(sorted) :
      value && typeof value === "object" ? Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
    process.stdin.on("data", (chunk) => input += chunk).on("end", () => {
      fs.writeFileSync(process.argv[1], JSON.stringify(sorted(JSON.parse(input))));
    });
  ' "$directory/$name.json"
}

require_deployment_checks() {
  local evidence=$1
  shift
  EVIDENCE_JSON="$evidence" node - "$@" <<'NODE'
const evidence = JSON.parse(process.env.EVIDENCE_JSON);
const rows = evidence.checks ?? [];
const checks = new Map(rows.map((row) => [row.id, row]));
for (const specification of process.argv.slice(2)) {
  const [id, kind, status] = specification.split(':');
  const row = checks.get(id);
  if (rows.filter((candidate) => candidate.id === id).length !== 1 ||
      !row || row.kind !== kind || row.status !== status ||
      !/^sha256:[0-9a-f]{64}$/.test(row.evidence_digest ?? '')) {
    process.stderr.write(`missing or invalid deployment check: ${specification}\n`);
    process.exit(1);
  }
}
NODE
}

require_no_deployment_check() {
  local evidence=$1 id=$2
  EVIDENCE_JSON="$evidence" node - "$id" <<'NODE'
const evidence = JSON.parse(process.env.EVIDENCE_JSON);
if ((evidence.checks ?? []).some((row) => row.id === process.argv[2])) {
  process.stderr.write(`unexpected deployment check: ${process.argv[2]}\n`);
  process.exit(1);
}
NODE
}

require_predeployment_backup() {
  local evidence=$1 previous_reference=$2 target=$3 snapshot metadata
  snapshot=$(EVIDENCE_JSON="$evidence" node <<'NODE'
const evidence = JSON.parse(process.env.EVIDENCE_JSON);
const rows = (evidence.checks ?? []).filter((row) =>
  row.id === 'pre-deployment-logical-backup');
if (rows.length !== 1 || rows[0].kind !== 'backup' || rows[0].status !== 'passed' ||
    !/^sha256:[0-9a-f]{64}$/.test(rows[0].evidence_digest ?? '')) process.exit(1);
process.stdout.write(rows[0].evidence_digest);
NODE
  ) || die 'production release transition lacks exactly one pre-deployment logical backup'
  metadata=".prism/backups/$target/${snapshot#sha256:}.json"
  test -f "$metadata" || die 'pre-deployment logical backup metadata is absent'
  PREVIOUS_DIGEST=${previous_reference##*@} SNAPSHOT_DIGEST=$snapshot TARGET_ID=$target \
    node - "$metadata" <<'NODE'
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const metadataPath = process.argv[2];
const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
assert.equal(value.schema, 'prismpm/backup-snapshot/1');
assert.equal(value.release_digest, process.env.PREVIOUS_DIGEST);
assert.equal(value.snapshot_digest, process.env.SNAPSHOT_DIGEST);
assert.equal(value.source_target, process.env.TARGET_ID);
assert.equal(value.status, 'pending-restore');
assert(Number.isSafeInteger(value.captured_unix) && value.captured_unix > 0);
assert.equal(value.dump_path,
  `.prism/backups/${process.env.TARGET_ID}/${process.env.SNAPSHOT_DIGEST.slice(7)}.sql`);
const dump = fs.readFileSync(value.dump_path);
assert.equal(`sha256:${crypto.createHash('sha256').update(dump).digest('hex')}`,
  value.snapshot_digest);
NODE
}

sha256_digest() {
  printf 'sha256:%s\n' "$(sha256sum "$1" | cut -d' ' -f1)"
}

expect_prismpm_failure() {
  local name=$1 expected=$2
  shift 2
  local directory stdout stderr exit_code actual
  directory=$(evidence_dir)
  stdout=$directory/$name.stdout.json
  stderr=$directory/$name.stderr.txt
  set +e
  "$@" >"$stdout" 2>"$stderr"
  exit_code=$?
  set -e
  test "$exit_code" -ne 0 || die "$name unexpectedly succeeded"
  actual=$(node -e \
    'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(value.diagnostic?.code??"")' \
    "$stdout")
  test "$actual" = "$expected" ||
    die "$name returned diagnostic $actual instead of $expected"
  node scripts/record-command-evidence.mjs \
    "$directory/$name.json" "$exit_code" "$expected" "$stdout" "$stderr" "$@"
}
