#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindRuntimeReference} from './runtime-binding.mjs';
import {
  acceptanceImages,
  acceptanceInfrastructureImages,
  externalImages,
  verifyAcceptanceImageReferences,
  verifyIndexBytes,
} from './external-image-contract.mjs';
import {createHash} from 'node:crypto';

const original = readFileSync('src/CalculatorSystem.lex.tex', 'utf8');
const source = bindRuntimeReference(original,
  `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'a'.repeat(64)}`);
const candidate = source.replaceAll(
  '"value":"ghcr.io/uor-foundation/prismpm-runtime"',
  '"value":"localhost:5000/prismpm-runtime"');
assert.notEqual(candidate, source, 'public-runtime defect was not planted');
assert.throws(() => externalImages(candidate), /public released PrismPM runtime/);
const rows = externalImages(source);
assert.equal(rows.length, 6);
assert.deepEqual(rows.map((row) => row.id), [
  'broker-image', 'database-image', 'kind-ingress-admission',
  'kind-ingress-controller', 'runtime-image', 'telemetry-image',
]);
assert.deepEqual(acceptanceInfrastructureImages.map((row) => row.id), ['kind-node-v1.36.4']);
assert.deepEqual(acceptanceImages(source).map((row) => row.id), [
  'broker-image', 'database-image', 'kind-ingress-admission',
  'kind-ingress-controller', 'kind-node-v1.36.4', 'runtime-image', 'telemetry-image',
]);
assert.throws(() => acceptanceImages(source.replaceAll(
  '"value":"broker-image"', '"value":"kind-node-v1.36.4"')),
  /acceptance image IDs are duplicated/);
const acceptance = readFileSync('scripts/acceptance.sh', 'utf8');
verifyAcceptanceImageReferences(acceptance);
assert.throws(() => verifyAcceptanceImageReferences(acceptance.replace(
  acceptanceInfrastructureImages[0].digest, `sha256:${'0'.repeat(64)}`)),
  /differs from its verified identity/);

const index = {
  manifests: [
    {platform: {architecture: 'amd64', os: 'linux'}},
    {platform: {architecture: 'arm64', os: 'linux'}},
  ],
  mediaType: 'application/vnd.oci.image.index.v1+json',
  schemaVersion: 2,
};
const bytes = Buffer.from(JSON.stringify(index));
const row = {
  digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  id: 'planted-index',
  media_type: index.mediaType,
};
verifyIndexBytes(row, bytes);
assert.throws(() => verifyIndexBytes({...row, digest: `sha256:${'0'.repeat(64)}`}, bytes),
  /registry bytes differ/);
const narrowed = Buffer.from(JSON.stringify({...index, manifests: [index.manifests[0]]}));
assert.throws(() => verifyIndexBytes({
  ...row,
  digest: `sha256:${createHash('sha256').update(narrowed).digest('hex')}`,
}, narrowed), /lacks linux\/arm64/);
process.stdout.write('external image contract positive and adversarial tests passed\n');
