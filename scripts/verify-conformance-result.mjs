#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const [resultPath, reference, lockPath, inventoryPath] = process.argv.slice(2);
if (!resultPath || !reference || !lockPath || !inventoryPath) {
  throw new Error(
    'usage: verify-conformance-result.mjs RESULT REFERENCE PRISMPM_LOCK SDK_INVENTORY',
  );
}

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
      .map((key) => [key, canonical(value[key])]),
  ) : value;
const encode = (value) => JSON.stringify(canonical(value));
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const parse = async (path, requireCanonical = false) => {
  const bytes = await readFile(path);
  const value = JSON.parse(bytes);
  if (requireCanonical && encode(value) !== bytes.toString('utf8')) {
    throw new Error(`${path} is not canonical JSON without a trailing newline`);
  }
  return { bytes, value };
};
const exactKeys = (value, keys, label) => {
  const observed = Object.keys(value).sort().join('\n');
  const expected = [...keys].sort().join('\n');
  if (observed !== expected) throw new Error(`${label} has an open or incomplete shape`);
};
const requireDigest = (value, label) => {
  if (!digestPattern.test(value ?? '')) throw new Error(`${label} is not a SHA-256 digest`);
};

const result = (await parse(resultPath, true)).value;
exactKeys(result, [
  'diagnostic_count', 'feature_count', 'referrer_digest', 'release_digest',
  'runner_digest', 'schema', 'sdk_digest', 'status', 'transcript_digest',
  'transcript_path',
], 'conformance result');
if (result.schema !== 'prismpm/conformance-result/1' || result.status !== 'accepted' ||
    result.feature_count !== 147 || result.diagnostic_count !== 83) {
  throw new Error('conformance result is not the complete accepted PrismPM 0.3.0 corpus');
}
for (const field of [
  'referrer_digest', 'release_digest', 'runner_digest', 'sdk_digest', 'transcript_digest',
]) requireDigest(result[field], `conformance result ${field}`);
const separator = reference.lastIndexOf('@');
if (separator < 1 || reference.slice(separator + 1) !== result.release_digest) {
  throw new Error('conformance result is bound to a different release reference');
}

const lock = (await parse(lockPath)).value;
if (lock.schema !== 'prismpm/sdk-lock/1' || typeof lock.sdk_image !== 'string' ||
    lock.sdk_image.slice(lock.sdk_image.lastIndexOf('@') + 1) !== result.sdk_digest) {
  throw new Error('conformance result is bound to a different locked SDK image');
}
const inventory = (await parse(inventoryPath)).value;
if (inventory.schema !== 'prismpm/sdk-inventory/1' || !Array.isArray(inventory.artifacts)) {
  throw new Error('SDK inventory is malformed');
}
const runners = inventory.artifacts.filter((row) => row.id === 'prismpm-conformance');
if (runners.length !== 1 || runners[0].kind !== 'binary' ||
    runners[0].digest !== result.runner_digest) {
  throw new Error('conformance result is bound to a different SDK conformance runner');
}

const projectRoot = await realpath(dirname(resolve(lockPath)));
const confinedFile = async (path) => {
  const absolute = resolve(projectRoot, path);
  const local = relative(projectRoot, absolute);
  if (local.startsWith('..') || local === '' || await realpath(absolute) !== absolute) {
    throw new Error('conformance evidence path escapes the project or crosses a symlink');
  }
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('conformance evidence is not a regular file');
  }
  return absolute;
};
const transcriptPath = resolve(projectRoot, result.transcript_path);
const transcriptRelative = relative(projectRoot, transcriptPath);
if (transcriptRelative.startsWith('..') || transcriptRelative === '' ||
    resolve(projectRoot, transcriptRelative) !== transcriptPath) {
  throw new Error('conformance transcript path escapes the project');
}
const transcriptMetadata = await lstat(transcriptPath);
if (!transcriptMetadata.isFile() || transcriptMetadata.isSymbolicLink()) {
  throw new Error('conformance transcript is not a regular file');
}
const transcriptDocument = await parse(await confinedFile(transcriptPath), true);
if (sha(transcriptDocument.bytes) !== result.transcript_digest) {
  throw new Error('conformance transcript bytes do not match the result digest');
}
const transcript = transcriptDocument.value;
exactKeys(transcript, [
  'cases', 'coverage_digest', 'diagnostic_count', 'feature_count', 'release_digest',
  'runner_digest', 'schema', 'sdk_digest', 'status',
], 'conformance transcript');
if (transcript.schema !== 'prismpm/production-acceptance/1' ||
    transcript.status !== 'accepted' || transcript.feature_count !== 147 ||
    transcript.diagnostic_count !== 83 ||
    transcript.release_digest !== result.release_digest ||
    transcript.sdk_digest !== result.sdk_digest ||
    transcript.runner_digest !== result.runner_digest ||
    !Array.isArray(transcript.cases) || transcript.cases.length !== 230) {
  throw new Error('conformance transcript does not close the result identities and corpus');
}
requireDigest(transcript.coverage_digest, 'conformance transcript coverage_digest');

// Independently bind the claimed transcript to the actual immutable release
// bytes and discoverable OCI subject referrer, not merely to other claims in
// the command response. Standard conformance remains the SDK oracle's job.
const manifestMediaType = 'application/vnd.oci.image.manifest.v1+json';
const acceptanceMediaType = 'application/vnd.prismpm.production.acceptance.v1+json';
const readBlob = async (digest, size) => {
  requireDigest(digest, 'OCI descriptor digest');
  const path = await confinedFile(`.prism/oci/blobs/sha256/${digest.slice(7)}`);
  const bytes = await readFile(path);
  if (sha(bytes) !== digest || (size !== undefined &&
      (!Number.isSafeInteger(size) || size < 0 || size !== bytes.length))) {
    throw new Error('OCI descriptor bytes do not match their digest and size');
  }
  return bytes;
};
const releaseBytes = await readBlob(result.release_digest);
const release = JSON.parse(releaseBytes);
const coverageRows = release.layers?.filter((row) =>
  row.annotations?.['org.opencontainers.image.title'] === 'projections/capability-coverage.json');
if (release.schemaVersion !== 2 || release.mediaType !== manifestMediaType ||
    release.artifactType !== 'application/vnd.prismpm.product.release.v1+json' ||
    !coverageRows || coverageRows.length !== 1) {
  throw new Error('release does not contain one unambiguous generated coverage artifact');
}
const coverageRow = coverageRows[0];
const coverageBytes = await readBlob(coverageRow.digest, coverageRow.size);
if (sha(coverageBytes) !== transcript.coverage_digest) {
  throw new Error('conformance coverage digest does not bind the generated release coverage bytes');
}
const coverage = JSON.parse(coverageBytes);
if (coverage.schema !== 'prismpm/capability-coverage/1' ||
    !Array.isArray(coverage.features) || !Array.isArray(coverage.diagnostics)) {
  throw new Error('release coverage identities are malformed');
}
const coveredIdentities = [
  ...coverage.features.map((row) => `feature:${row.feature_id}`),
  ...coverage.diagnostics.map((row) => `diagnostic:${row.code}`),
];
const referrerBytes = await readBlob(result.referrer_digest);
const referrer = JSON.parse(referrerBytes);
const expectedReferrer = {
  artifactType: acceptanceMediaType,
  config: {
    digest: sha('{}'), mediaType: 'application/vnd.oci.empty.v1+json', size: 2,
  },
  layers: [{
    digest: result.transcript_digest, mediaType: acceptanceMediaType,
    size: transcriptDocument.bytes.length,
  }],
  mediaType: manifestMediaType,
  schemaVersion: 2,
  subject: {
    artifactType: release.artifactType, digest: result.release_digest,
    mediaType: manifestMediaType, size: releaseBytes.length,
  },
};
if (referrerBytes.toString('utf8') !== encode(expectedReferrer)) {
  throw new Error('acceptance referrer does not bind the exact transcript and release subject');
}
await readBlob(referrer.config.digest, referrer.config.size);
const attachedBytes = await readBlob(referrer.layers[0].digest, referrer.layers[0].size);
if (!attachedBytes.equals(transcriptDocument.bytes)) {
  throw new Error('acceptance referrer attaches different transcript bytes');
}
const index = (await parse(await confinedFile('.prism/oci/index.json'), true)).value;
const indexed = index.manifests?.filter((row) => row.digest === result.referrer_digest);
if (!indexed || indexed.length !== 1 || encode(indexed[0]) !== encode({
  artifactType: acceptanceMediaType, digest: result.referrer_digest,
  mediaType: manifestMediaType, size: referrerBytes.length,
})) {
  throw new Error('acceptance referrer is absent or malformed in the OCI index');
}
const identities = new Set();
let features = 0;
let diagnostics = 0;
for (const row of transcript.cases) {
  if (!row || typeof row !== 'object' || row.status !== 'passed') {
    throw new Error('conformance transcript contains a non-passing case');
  }
  if (row.kind === 'feature') {
    exactKeys(row, ['command', 'diagnostic', 'evidence_digest', 'feature_id', 'kind', 'status'],
      'feature case');
    if (!/^[A-Z]{2}-[0-9]{2}$/.test(row.feature_id ?? '') || row.diagnostic !== null ||
        row.command !== `prismpm-conformance --feature ${row.feature_id}`) {
      throw new Error('conformance transcript contains a malformed feature case');
    }
    features += 1;
    identities.add(`feature:${row.feature_id}`);
  } else if (row.kind === 'diagnostic') {
    exactKeys(row, ['command', 'diagnostic', 'evidence_digest', 'feature_id', 'kind', 'status'],
      'diagnostic case');
    if (!/^PP[0-9]{4}$/.test(row.diagnostic ?? '') || row.feature_id !== null ||
        row.command !== `prismpm-conformance --diagnostic ${row.diagnostic}`) {
      throw new Error('conformance transcript contains a malformed diagnostic case');
    }
    diagnostics += 1;
    identities.add(`diagnostic:${row.diagnostic}`);
  } else {
    throw new Error('conformance transcript contains an unknown case kind');
  }
  requireDigest(row.evidence_digest, 'conformance case evidence_digest');
}
if (features !== 147 || diagnostics !== 83 || identities.size !== 230) {
  throw new Error('conformance transcript case identities are incomplete or duplicated');
}
if (coveredIdentities.length !== 230 || new Set(coveredIdentities).size !== 230 ||
    coveredIdentities.some((identity) => !identities.has(identity))) {
  throw new Error('conformance case identities do not match generated release coverage');
}
process.stdout.write(`${result.transcript_digest}\n`);
