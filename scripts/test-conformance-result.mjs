#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'calculator-conformance-result.'));
process.on('exit', () => rmSync(root, { force: true, recursive: true }));
const digest = (character) => `sha256:${character.repeat(64)}`;
const sort = (value) => Array.isArray(value) ? value.map(sort) :
  value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sort(value[key])]),
  ) : value;
const canonical = (value) => JSON.stringify(sort(value));
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const store = join(root, '.prism/oci/blobs/sha256');
await mkdir(store, {recursive: true});
const put = async (value, mediaType) => {
  const bytes = Buffer.from(canonical(value));
  const digest = sha(bytes);
  await writeFile(join(store, digest.slice(7)), bytes);
  return {digest, mediaType, size: bytes.length};
};
const cases = [
  ...Array.from({ length: 147 }, (_, index) => {
    const featureId = `${String.fromCharCode(65 + Math.floor(index / 100))}${String.fromCharCode(65 + Math.floor((index % 100) / 10))}-${String(index % 100).padStart(2, '0')}`;
    return {
      command: `prismpm-conformance --feature ${featureId}`,
      diagnostic: null,
      evidence_digest: digest((index % 10).toString()),
      feature_id: featureId,
      kind: 'feature',
      status: 'passed',
    };
  }),
  ...Array.from({ length: 83 }, (_, index) => {
    const diagnostic = `PP${String(index).padStart(4, '0')}`;
    return {
      command: `prismpm-conformance --diagnostic ${diagnostic}`,
      diagnostic,
      evidence_digest: digest(((index + 1) % 10).toString()),
      feature_id: null,
      kind: 'diagnostic',
      status: 'passed',
    };
  }),
];
const coverage = {
  diagnostics: cases.filter((row) => row.kind === 'diagnostic').map((row) => ({code: row.diagnostic})),
  features: cases.filter((row) => row.kind === 'feature').map((row) => ({feature_id: row.feature_id})),
  model_digest: digest('a'),
  schema: 'prismpm/capability-coverage/1',
};
const coverageDescriptor = await put(coverage, 'application/json');
const release = {
  artifactType: 'application/vnd.prismpm.product.release.v1+json',
  config: await put({}, 'application/vnd.oci.empty.v1+json'),
  layers: [{...coverageDescriptor,
    annotations: {'org.opencontainers.image.title': 'projections/capability-coverage.json'}}],
  mediaType: 'application/vnd.oci.image.manifest.v1+json', schemaVersion: 2,
};
const releaseDescriptor = {...await put(release, release.mediaType), artifactType: release.artifactType};
const transcript = {
  cases,
  coverage_digest: coverageDescriptor.digest,
  diagnostic_count: 83,
  feature_count: 147,
  release_digest: releaseDescriptor.digest,
  runner_digest: digest('b'),
  schema: 'prismpm/production-acceptance/1',
  sdk_digest: digest('d'),
  status: 'accepted',
};
const transcriptBytes = canonical(transcript);
const transcriptDigest = `sha256:${createHash('sha256').update(transcriptBytes).digest('hex')}`;
const transcriptPath = join(root, 'transcript.json');
await writeFile(transcriptPath, transcriptBytes);
const acceptanceMediaType = 'application/vnd.prismpm.production.acceptance.v1+json';
const referrer = {
  artifactType: acceptanceMediaType,
  config: release.config,
  layers: [await put(transcript, acceptanceMediaType)],
  mediaType: release.mediaType, schemaVersion: 2,
  subject: releaseDescriptor,
};
const referrerDescriptor = {...await put(referrer, release.mediaType), artifactType: acceptanceMediaType};
const indexPath = join(root, '.prism/oci/index.json');
const index = {manifests: [releaseDescriptor, referrerDescriptor], schemaVersion: 2};
await writeFile(indexPath, canonical(index));
const result = {
  diagnostic_count: 83,
  feature_count: 147,
  referrer_digest: referrerDescriptor.digest,
  release_digest: releaseDescriptor.digest,
  runner_digest: digest('b'),
  schema: 'prismpm/conformance-result/1',
  sdk_digest: digest('d'),
  status: 'accepted',
  transcript_digest: transcriptDigest,
  transcript_path: 'transcript.json',
};
const resultPath = join(root, 'result.json');
const lockPath = join(root, 'prismpm.lock');
const inventoryPath = join(root, 'inventory.json');
await writeFile(resultPath, canonical(result));
await writeFile(lockPath, JSON.stringify({
  schema: 'prismpm/sdk-lock/1',
  sdk_image: `ghcr.io/uor-foundation/prismpm-sdk@${digest('d')}`,
}));
await writeFile(inventoryPath, JSON.stringify({
  artifacts: [{ digest: digest('b'), id: 'prismpm-conformance', kind: 'binary', version: '0.3.0' }],
  commands: [{ command: 'prismpm' }],
  schema: 'prismpm/sdk-inventory/1',
}));
const verifier = new URL('./verify-conformance-result.mjs', import.meta.url).pathname;
const run = (resultFile = resultPath) => spawnSync(process.execPath, [
  verifier, resultFile, `ghcr.io/uor-foundation/calculator-system@${releaseDescriptor.digest}`,
  lockPath, inventoryPath,
], { encoding: 'utf8' });
assert.equal(run().status, 0, run().stderr);

const reject = async (name, mutate) => {
  const candidate = structuredClone(result);
  await mutate(candidate);
  const path = join(root, `${name}.json`);
  await writeFile(path, canonical(candidate));
  assert.notEqual(run(path).status, 0, `${name} was accepted`);
};
await reject('wrong-release', (value) => { value.release_digest = digest('f'); });
await reject('wrong-sdk', (value) => { value.sdk_digest = digest('f'); });
await reject('wrong-runner', (value) => { value.runner_digest = digest('f'); });
await reject('wrong-transcript-digest', (value) => { value.transcript_digest = digest('f'); });
await reject('wrong-referrer', (value) => { value.referrer_digest = digest('f'); });
await reject('partial-corpus', (value) => { value.feature_count = 146; });
await reject('open-result', (value) => { value.extra = true; });
const noncanonical = join(root, 'noncanonical.json');
await writeFile(noncanonical, `${JSON.stringify(result, null, 2)}\n`);
assert.notEqual(run(noncanonical).status, 0, 'noncanonical result was accepted');
const transcriptLink = join(root, 'transcript-link.json');
await symlink(transcriptPath, transcriptLink);
await reject('symlink-transcript', (value) => { value.transcript_path = 'transcript-link.json'; });
await reject('escaping-transcript', (value) => { value.transcript_path = '../outside.json'; });
await mkdir(join(root, 'actual'));
await writeFile(join(root, 'actual/transcript.json'), transcriptBytes);
await symlink(join(root, 'actual'), join(root, 'linked-directory'));
await reject('symlink-parent', (value) => { value.transcript_path = 'linked-directory/transcript.json'; });

const rejectTranscript = async (name, mutate, diagnostic) => {
  const candidate = structuredClone(transcript);
  mutate(candidate);
  const bytes = canonical(candidate);
  await writeFile(transcriptPath, bytes);
  const candidateReferrer = {...referrer, layers: [await put(candidate, acceptanceMediaType)]};
  const candidateDescriptor = {...await put(candidateReferrer, release.mediaType), artifactType: acceptanceMediaType};
  await writeFile(indexPath, canonical({...index, manifests: [releaseDescriptor, candidateDescriptor]}));
  const candidateResult = {...result, transcript_digest: sha(bytes), referrer_digest: candidateDescriptor.digest};
  await writeFile(resultPath, canonical(candidateResult));
  const observed = run();
  assert.notEqual(observed.status, 0, `${name} was accepted`);
  assert.match(observed.stderr, diagnostic, `${name} failed at an unrelated boundary`);
  await writeFile(resultPath, canonical(result));
  await writeFile(transcriptPath, transcriptBytes);
  await writeFile(indexPath, canonical(index));
};
await rejectTranscript('stale-coverage', (value) => { value.coverage_digest = digest('f'); },
  /coverage digest does not bind/);
await rejectTranscript('substituted-case-identity', (value) => {
  value.cases[0].feature_id = 'ZZ-99';
  value.cases[0].command = 'prismpm-conformance --feature ZZ-99';
}, /case identities do not match/);
await reject('wrong-referrer-subject', async (value) => {
  const wrong = {...referrer, subject: {...releaseDescriptor, digest: digest('f')}};
  const descriptor = {...await put(wrong, release.mediaType), artifactType: acceptanceMediaType};
  value.referrer_digest = descriptor.digest;
  await writeFile(indexPath, canonical({...index, manifests: [releaseDescriptor, descriptor]}));
});
await writeFile(indexPath, canonical(index));
await writeFile(indexPath, canonical({...index, manifests: [releaseDescriptor]}));
assert.notEqual(run().status, 0, 'undiscoverable acceptance referrer was accepted');
await writeFile(indexPath, canonical(index));
await writeFile(join(store, coverageDescriptor.digest.slice(7)), '{}');
assert.notEqual(run().status, 0, 'mutated generated coverage bytes were accepted');
await put(coverage, coverageDescriptor.mediaType);
await writeFile(join(store, referrerDescriptor.digest.slice(7)), '{}');
assert.notEqual(run().status, 0, 'mutated acceptance referrer bytes were accepted');
await put(referrer, release.mediaType);
assert.equal(run().status, 0, run().stderr);
await chmod(transcriptPath, 0o644);
assert.equal((await readFile(transcriptPath, 'utf8')), transcriptBytes);
process.stdout.write('conformance result binding adversarial tests passed\n');
