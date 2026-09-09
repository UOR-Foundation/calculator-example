#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {
  acceptanceImages,
  verifyAcceptanceImageReferences,
  verifyIndexBytes,
} from './external-image-contract.mjs';

const rows = acceptanceImages(readFileSync('src/CalculatorSystem.lex.tex', 'utf8'));
verifyAcceptanceImageReferences(readFileSync('scripts/acceptance.sh', 'utf8'));
const prior = new Set(execFileSync('docker', ['image', 'ls', '--no-trunc', '--quiet'], {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean));
const acquired = new Set();
let failure;
try {
  for (const row of rows) {
    const reference = `${row.path}@${row.digest}`;
    const raw = execFileSync('docker', ['buildx', 'imagetools', 'inspect', '--raw', reference], {
      maxBuffer: 16 * 1024 * 1024,
    });
    verifyIndexBytes(row, raw);
    for (const architecture of ['amd64', 'arm64']) {
      execFileSync('docker', ['pull', '--platform', `linux/${architecture}`, reference], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const inspected = execFileSync('docker', [
        'image', 'inspect', '--format', '{{.Id}} {{.Os}}/{{.Architecture}}', reference,
      ], {encoding: 'utf8'}).trim().split(/\s+/);
      assert.equal(inspected[1], `linux/${architecture}`,
        `${row.id} pull selected ${inspected[1]} instead of linux/${architecture}`);
      if (!prior.has(inspected[0])) acquired.add(inspected[0]);
    }
  }
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  for (const image of acquired) {
    const removed = spawnSync('docker', ['image', 'rm', image], {encoding: 'utf8'});
    if (removed.status !== 0) cleanupErrors.push(removed.stderr.trim() || image);
  }
  if (!failure && cleanupErrors.length > 0) {
    failure = new Error(`external image cleanup failed: ${cleanupErrors.join('; ')}`);
  }
}
if (failure) throw failure;
process.stdout.write(`external image indexes and both modeled platforms verified (${rows.length} images)\n`);
