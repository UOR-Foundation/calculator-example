import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseSemanticSource} from './runtime-binding.mjs';

function field(record, name) {
  assert.equal(record?.kind, 'record', `${name} parent is not a record`);
  const matches = record.fields.filter((row) => row.field === name);
  assert.equal(matches.length, 1, `expected exactly one ${name} field`);
  return matches[0].value;
}

function list(value, label) {
  const rows = [];
  let cursor = value;
  while (cursor?.kind === 'cons') {
    rows.push(cursor.head);
    cursor = cursor.tail;
  }
  assert.equal(cursor?.kind, 'nil', `${label} is not a closed list`);
  return rows;
}

const text = (record, name) => {
  const value = field(record, name);
  assert.equal(value?.kind, 'string', `${name} is not a string`);
  return value.value;
};

export function externalImages(source, {requirePublicRuntime = true} = {}) {
  const document = parseSemanticSource(source).document;
  const models = document.declarations.filter(
    (row) => row.kind === 'definition' && /^systemModel[AB]$/.test(row.name ?? ''),
  );
  assert.deepEqual(models.map((row) => row.name), ['systemModelA', 'systemModelB']);
  const releases = models.map((model) => list(field(model.body, 'artifacts'), `${model.name}.artifacts`)
    .filter((artifact) => {
      const mediaType = text(artifact, 'mediaType');
      return mediaType === 'application/vnd.oci.image.index.v1+json' ||
        mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json';
    }).map((artifact) => ({
      digest: text(artifact, 'digest'),
      id: text(artifact, 'id'),
      media_type: text(artifact, 'mediaType'),
      path: text(artifact, 'path'),
      platform_requirements: list(field(artifact, 'platformRequirements'),
        `${text(artifact, 'id')}.platformRequirements`).map((value) => value.value),
    })));
  assert.deepEqual(releases[0], releases[1], 'A/B external image closures differ');
  const rows = releases[0];
  assert(rows.length > 0, 'external image closure is absent');
  for (const row of rows) {
    assert(/^[a-z0-9.-]+(?::[0-9]{1,5})?\/[a-z0-9./_-]+$/.test(row.path),
      `${row.id} image path is malformed`);
    assert(/^sha256:[0-9a-f]{64}$/.test(row.digest), `${row.id} digest is malformed`);
    assert.deepEqual(row.platform_requirements, ['linux-oci'],
      `${row.id} is not bound to the modeled Linux OCI platform`);
    if (row.id === 'runtime-image' && requirePublicRuntime) {
      assert.equal(row.path, 'ghcr.io/uor-foundation/prismpm-runtime',
        'runtime-image is not the public released PrismPM runtime');
    }
  }
  rows.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length,
    'external image IDs are duplicated');
  return rows;
}

// Kind is acceptance infrastructure rather than an application artifact, so it
// must not be smuggled into the authoritative SystemModel artifact closure. It
// is still an externally acquired executable input and therefore receives the
// same byte-identity and two-platform verification before protected acceptance.
export const acceptanceInfrastructureImages = Object.freeze([Object.freeze({
  digest: 'sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed',
  id: 'kind-node-v1.36.4',
  media_type: 'application/vnd.oci.image.index.v1+json',
  path: 'docker.io/kindest/node',
  platform_requirements: Object.freeze(['linux-oci']),
})]);

export function acceptanceImages(source, options = {}) {
  const rows = [...externalImages(source, options), ...acceptanceInfrastructureImages];
  rows.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length,
    'acceptance image IDs are duplicated');
  return rows;
}

export function verifyAcceptanceImageReferences(script) {
  assert.equal(typeof script, 'string', 'acceptance program is absent');
  const references = [...script.matchAll(/(?:^|\s)--image\s+(\S+)/gm)].map((match) => match[1]);
  const expected = acceptanceInfrastructureImages.map((row) => `${row.path}@${row.digest}`);
  assert.deepEqual(references, expected,
    'acceptance infrastructure image reference differs from its verified identity');
}

export function verifyIndexBytes(row, output) {
  let bytes = Buffer.from(output);
  const expected = row.digest.slice('sha256:'.length);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  if (hash(bytes) !== expected && bytes.at(-1) === 0x0a) bytes = bytes.subarray(0, -1);
  assert.equal(hash(bytes), expected, `${row.id} registry bytes differ from the modeled digest`);
  const index = JSON.parse(bytes);
  assert.equal(index.mediaType, row.media_type, `${row.id} media type changed`);
  assert(Array.isArray(index.manifests) && index.manifests.length > 0,
    `${row.id} is not a multi-platform image index`);
  const platforms = new Set(index.manifests
    .filter((manifest) => manifest.platform?.os === 'linux')
    .map((manifest) => manifest.platform.architecture));
  for (const architecture of ['amd64', 'arm64']) {
    assert(platforms.has(architecture), `${row.id} lacks linux/${architecture}`);
  }
  return index;
}
