#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [reference, title, output] = process.argv.slice(2);
const match = reference?.match(/@sha256:([0-9a-f]{64})$/);
if (!match || !title || !output) {
  throw new Error('usage: extract-release-artifact.mjs REFERENCE TITLE OUTPUT');
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = async (hex, expectedSize) => {
  const path = resolve('.prism/oci/blobs/sha256', hex);
  const bytes = await readFile(path);
  if (digest(bytes) !== hex || (expectedSize !== undefined && bytes.length !== expectedSize)) {
    throw new Error(`OCI descriptor verification failed for sha256:${hex}`);
  }
  return bytes;
};
const manifestBytes = await blob(match[1]);
const manifest = JSON.parse(manifestBytes);
const row = manifest.layers?.find((layer) =>
  layer.annotations?.['org.opencontainers.image.title'] === title);
const layerMatch = row?.digest?.match(/^sha256:([0-9a-f]{64})$/);
if (!layerMatch || !Number.isSafeInteger(row.size)) {
  throw new Error(`release artifact is absent: ${title}`);
}
const bytes = await blob(layerMatch[1], row.size);
await writeFile(output, bytes);
process.stdout.write(`sha256:${layerMatch[1]}\n`);
