import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { expectedRuns, validateEvidenceSet } from './baseline-evidence.mjs';
import { validateHistoricalRecords } from './historical-baseline.mjs';

const require = createRequire('/opt/prismpm/oracles/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const recordPath = 'artifacts/calculator-baseline.json';
const requireSealed = process.argv.includes('--require-sealed');
const requireInputReady = process.argv.includes('--require-input-ready');
const requirePackageBootstrap = process.argv.includes('--require-package-bootstrap');
const requireProjectionBootstrap = process.argv.includes('--require-projection-bootstrap');
const verifyLive = process.argv.includes('--live');
const allowed = new Set([
  '--require-input-ready',
  '--require-package-bootstrap',
  '--require-projection-bootstrap',
  '--require-sealed',
  '--live',
]);
for (const argument of process.argv.slice(2)) {
  if (!allowed.has(argument)) throw new Error(`unknown argument ${argument}`);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const taggedSha256 = (bytes) => `sha256:${sha256(bytes)}`;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const assertDigest = (actual, expected, label) => {
  assert(actual === expected, `${label}: ${actual} != ${expected}`);
};
const field = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
const assertOrdered = (rows, key, label) => {
  const keys = rows.map(key);
  const expected = [...keys].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  assert(
    new Set(keys).size === keys.length && JSON.stringify(keys) === JSON.stringify(expected),
    `${label} is not byte-sorted and unique`,
  );
};

const raw = readFileSync(recordPath);
const record = JSON.parse(raw);
assert(
  raw.toString('utf8') === JSON.stringify(sorted(record)),
  `${recordPath} is not canonical sorted-key JSON without framing whitespace`,
);

const inventory = process.env.PRISMPM_SDK_INVENTORY;
assert(inventory, 'PRISMPM_SDK_INVENTORY is absent; run in the locked SDK');
const schemaPath = join(dirname(inventory), 'schemas', 'calculator-baseline.schema.json');
const schema = readJson(schemaPath);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
assert(validate(record), `baseline schema: ${JSON.stringify(validate.errors)}`);
if (requireSealed) {
  assert(record.status === 'sealed', 'Calculator baseline is not sealed');
  const lock = readJson('prismpm.lock');
  const evidenceDirectory = 'artifacts/baseline-evidence';
  const evidenceEntries = new Map(readdirSync(evidenceDirectory).map((filename) => {
    const path = join(evidenceDirectory, filename);
    assert(lstatSync(path).isFile(), `sealed baseline evidence is not a regular file: ${filename}`);
    return [filename, readFileSync(path)];
  }));
  const calculatorRun = JSON.parse(evidenceEntries.get('calculator-example-1.json'));
  const values = validateEvidenceSet(evidenceEntries, lock.sdk_image, calculatorRun.commit);
  for (const expected of expectedRuns) {
    const value = values.find(({repository, repeat}) =>
      repository === expected.repository && repeat === expected.repeat);
    const row = record.verification_runs.find(({repository, repeat}) =>
      repository === expected.repository && repeat === expected.repeat);
    const repository = record.repositories.find((candidate) =>
      candidate.repository === expected.repository);
    assert(
      row?.evidence_digest === taggedSha256(evidenceEntries.get(expected.filename)),
      `${expected.filename} does not match its sealed baseline digest`,
    );
    assert(
      repository?.commit === value?.commit,
      `${expected.filename} does not match its sealed repository commit`,
    );
  }
}
if (requireProjectionBootstrap) {
  assert(record.status === 'unsealed', 'projection bootstrap is only valid before the first seal');
  assert(
    record.formatting_correction.corrected_projection.availability === 'absent' &&
      record.remediation.current_closure.availability === 'absent',
    'projection bootstrap cannot overwrite an existing current release claim',
  );
}
if (requirePackageBootstrap) {
  assert(record.status === 'unsealed', 'package bootstrap is only valid before the first seal');
  const calculatorPublication = record.remediation.publications.filter(
    (row) => row.name === 'prism-calculator' && row.version === '0.1.0',
  );
  assert(
    calculatorPublication.length === 1 &&
      calculatorPublication[0].public_registry.availability === 'absent',
    'package bootstrap cannot overwrite an existing prism-calculator publication claim',
  );
}
if (requireInputReady) {
  assert(record.status === 'unsealed', 'baseline input is only valid before the first seal');
  assert(
    record.formatting_correction.corrected_projection.availability === 'present',
    'corrected projection identity is not ready for baseline input',
  );
  assert(
    record.remediation.current_closure.availability === 'present',
    'current Calculator closure is not ready for baseline input',
  );
  assert(
    record.remediation.publications.every((row) => row.public_registry.availability === 'present'),
    'required public Calculator packages are not ready for baseline input',
  );
  const calculatorInput = record.verification_runs.filter(
    (row) => row.repository === 'https://github.com/UOR-Foundation/calculator-example' &&
      row.command === 'just baseline-input',
  );
  assert(
    calculatorInput.length === 1 && calculatorInput[0].availability === 'absent' &&
      calculatorInput[0].evidence_digest === null,
    'baseline input row must be one absent Calculator transcript with no invented digest',
  );
}
assertOrdered(record.repositories, (row) => row.repository, 'baseline repositories');
assertOrdered(record.historical.packages, (row) => row.name, 'historical packages');
assertOrdered(record.historical.pages.assets, (row) => row.path, 'historical Pages assets');
assertOrdered(record.remediation.publications, (row) => row.name, 'remediation publications');
assertOrdered(
  record.verification_runs,
  (row) => `${row.repository}\0${String(row.repeat).padStart(2, '0')}`,
  'verification runs',
);
if (record.remediation.current_closure.availability === 'present') {
  assertOrdered(
    record.remediation.current_closure.pages.assets,
    (row) => row.path,
    'current Pages assets',
  );
}

const calculator = record.repositories.find(
  (row) => row.repository === 'https://github.com/UOR-Foundation/calculator-example',
);
assert(calculator, 'Calculator baseline repository row is absent');
const historical = record.historical.identities;
const historicalCommit = record.historical.pages.commit;
assert(
  /^[0-9a-f]{40}$/.test(historicalCommit ?? ''),
  'historical Calculator release does not bind a full Git commit',
);
const historicalRecords = validateHistoricalRecords(record, readFileSync);
const historicalFiles = new Map([
  ['src/Calculator.lex.tex', 'source_sha256'],
  ['artifacts/application-acceptance.json', 'application_acceptance_sha256'],
  ['artifacts/build-manifest.json', 'build_manifest_sha256'],
  ['artifacts/model.prism.json', 'model_id'],
  ['artifacts/view-manifest.json', 'view_manifest_sha256'],
  ['artifacts/Calculator.holo', 'holo_sha256'],
]);
const historicalBytes = (path) => execFileSync('git', [
  '-c',
  `safe.directory=${process.cwd()}`,
  'show',
  `${historicalCommit}:${path}`,
]);
assert(
  historicalBytes('RELEASE-CANDIDATE.json').equals(
    readFileSync('artifacts/historical-release-candidate.json'),
  ),
  'preserved historical release-candidate record differs from its accepted commit',
);
const historicalCandidate = historicalRecords.candidate;
assert(
  historicalCandidate.schema === 'calculator-example/release-candidate/1' &&
    historicalCandidate.application === 'Calculator' &&
    historicalCandidate.application_acceptance.status === 'verified',
  'historical release-candidate record is malformed',
);
for (const [actual, expected, label] of [
  [historicalCandidate.application_acceptance.artifact_sha256,
    historical.application_acceptance_sha256, 'application acceptance'],
  [historicalCandidate.application_acceptance.verification_manifest_sha256,
    sha256(historicalBytes('artifacts/verification-manifest.json')), 'verification manifest'],
  [historicalCandidate.build_id, historical.build_id, 'build ID'],
  [historicalCandidate.holo.application_kappa, historical.application_kappa, 'application kappa'],
  [historicalCandidate.holo.archive_fingerprint, historical.archive_fingerprint,
    'archive fingerprint'],
  [historicalCandidate.holo.archive_kappa, historical.archive_kappa, 'archive kappa'],
  [historicalCandidate.holo.guest_content_kappa, historical.guest_content_kappa,
    'guest-content kappa'],
  [historicalCandidate.holo.model_content_kappa, historical.model_content_kappa,
    'model-content kappa'],
  [historicalCandidate.holo.sha256, historical.holo_sha256, 'Holo digest'],
  [historicalCandidate.holo.view_content_kappa, historical.view_content_kappa,
    'View-content kappa'],
  [historicalCandidate.model.generated_core_sha256, historical.generated_core_sha256,
    'generated core'],
  [historicalCandidate.model.model_id, historical.model_id, 'model ID'],
  [historicalCandidate.model.source_id, historical.source_id, 'source ID'],
  [historicalCandidate.model.source_root_sha256, historical.source_sha256, 'source root'],
  [historicalCandidate.model.view_model_id, historical.view_model_id, 'View model ID'],
]) assertDigest(actual, expected, `historical release candidate ${label}`);
assertDigest(
  historicalCandidate.dependencies.prismpm_commit,
  record.bootstrap_sdk.source_commit,
  'historical release candidate PrismPM commit',
);
for (const fieldName of [
  'hologram_live_commit', 'lean4_prod_commit', 'lexlean_commit', 'prismpm_commit',
  'uor_hologram_commit',
]) {
  assert(
    /^[0-9a-f]{40}$/.test(historicalCandidate.dependencies[fieldName] ?? ''),
    `historical release candidate ${fieldName} is not a full commit`,
  );
}
const candidatePackages = new Map(historicalCandidate.packages.map((row) => [
  `${row.name}@${row.version}`, row,
]));
for (const publication of record.historical.packages) {
  const candidate = candidatePackages.get(`${publication.name}@${publication.version}`);
  assert(
    candidate?.publication === 'local-registry-release-candidate' &&
      candidate.sha256 === publication.committed_archive_sha256,
    `historical ${publication.name} candidate binding changed`,
  );
}
assert(
  candidatePackages.size === record.historical.packages.length,
  'historical release candidate package closure changed',
);
const historicalPageManifest = Buffer.from(record.historical.pages.assets.map((asset) =>
  `${asset.committed_sha256}  public/${asset.path}\n`).join(''));
assertDigest(
  historicalCandidate.pages.production_manifest_sha256,
  sha256(historicalPageManifest),
  'historical Pages aggregate',
);
assert(
  historicalCandidate.pages.url === record.historical.pages.url,
  'historical release candidate Pages URL changed',
);
for (const [path, identity] of historicalFiles) {
  const bytes = historicalBytes(path);
  assertDigest(sha256(bytes), historical[identity], `historical ${path}`);
}
for (const publication of record.historical.packages) {
  const path = `registry/${publication.name}-${publication.version}.crate`;
  assertDigest(
    sha256(historicalBytes(path)),
    publication.committed_archive_sha256,
    `historical ${path}`,
  );
}
for (const asset of record.historical.pages.assets) {
  const path = `public/${asset.path}`;
  assertDigest(sha256(historicalBytes(path)), asset.committed_sha256, `historical ${path}`);
}

const closure = record.remediation.current_closure.availability === 'present'
  ? record.remediation.current_closure
  : { identities: historical, pages: record.historical.pages };
const identities = closure.identities;
const currentFiles = new Map([
  ['src/Calculator.lex.tex', 'source_sha256'],
  ['artifacts/application-acceptance.json', 'application_acceptance_sha256'],
  ['artifacts/build-manifest.json', 'build_manifest_sha256'],
  ['artifacts/model.prism.json', 'model_id'],
  ['artifacts/view-manifest.json', 'view_manifest_sha256'],
  ['artifacts/Calculator.holo', 'holo_sha256'],
]);
if (!requireProjectionBootstrap) {
  for (const [path, identity] of currentFiles) {
    assertDigest(sha256(readFileSync(path)), identities[identity], `current ${path}`);
  }

  const acceptance = readJson('artifacts/application-acceptance.json');
  const view = readJson('artifacts/view-manifest.json');
  const provenance = readJson('public/provenance.json');
  for (const [path, expected] of [
  ['build_id', identities.build_id],
  ['source_id', identities.source_id],
  ['core_wasm.sha256', identities.core_wasm_sha256],
  ['holo.application_kappa', identities.application_kappa],
  ['holo.archive_fingerprint', identities.archive_fingerprint],
  ['holo.archive_kappa', identities.archive_kappa],
  ['holo.guest_content_kappa', identities.guest_content_kappa],
  ['holo.model_content_kappa', identities.model_content_kappa],
  ['holo.view_content_kappa', identities.view_content_kappa],
  ]) assertDigest(field(acceptance, path), expected, `application acceptance ${path}`);
  for (const [path, expected] of [
  ['generated_core_sha256', identities.generated_core_sha256],
  ['model_id', identities.model_id],
  ['view_model_id', identities.view_model_id],
  ]) assertDigest(field(view, path), expected, `View manifest ${path}`);
  for (const [path, expected] of [
  ['generated_core_sha256', identities.generated_core_sha256],
  ['model_id', identities.model_id],
  ['view_model_id', identities.view_model_id],
  ]) assertDigest(field(provenance, path), expected, `browser provenance ${path}`);

  for (const asset of closure.pages.assets) {
    const local = readFileSync(join('public', asset.path));
    assertDigest(sha256(local), asset.committed_sha256, `current public/${asset.path}`);
  }
}

const requestOptions = {
  headers: { 'user-agent': 'PrismPM-Calculator-baseline/1' },
};
const fetchBytes = async (url) => {
  const response = await fetch(url, { ...requestOptions, redirect: 'follow' });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
if (verifyLive) {
  const publication = JSON.parse(execFileSync('node', [
    'scripts/verify-pages-publication.mjs',
    closure.pages.url,
    closure.pages.commit,
  ], {encoding: 'utf8'}));
  assert(publication.status === 'passed', 'live Pages publication did not pass');
  assertOrdered(publication.assets, (row) => row.path, 'live Pages publication assets');
  assert(
    publication.assets.length === closure.pages.assets.length,
    'live Pages publication asset count changed',
  );
  for (const [index, asset] of closure.pages.assets.entries()) {
    const observed = publication.assets[index];
    assert(observed.path === asset.path, `served Pages path changed: ${asset.path}`);
    assertDigest(observed.sha256.slice(7), asset.served_sha256, `served ${asset.path}`);
  }
  const correctedProjection = record.formatting_correction.corrected_projection;
  if (correctedProjection.availability === 'present') {
    const bytes = await fetchBytes(correctedProjection.location);
    assert(bytes.length === correctedProjection.size, 'corrected projection public size changed');
    assertDigest(sha256(bytes), correctedProjection.sha256, 'corrected projection public bytes');
  }
  const binary = record.bootstrap_sdk.binary;
  const bytes = await fetchBytes(binary.location);
  assert(bytes.length === binary.size, 'bootstrap SDK binary size changed');
  assertDigest(sha256(bytes), binary.sha256, 'bootstrap SDK binary');
  // Historical absence is a dated observation, not a requirement that the
  // registry remain empty forever. The remediation rows below verify current
  // public bytes without rewriting that historical fact.
  for (const publication of record.remediation.publications) {
    if (publication.public_registry.availability !== 'present') continue;
    const bytes = await fetchBytes(publication.public_registry.location);
    assert(bytes.length === publication.public_registry.size, `${publication.name} public size changed`);
    assertDigest(sha256(bytes), publication.public_registry.sha256, `${publication.name} public crate`);
  }
}

process.stdout.write(`${record.schema} ${record.status} verified\n`);
