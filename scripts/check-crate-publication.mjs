import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [archivePath, mode] = process.argv.slice(2);
if (!archivePath || (mode !== undefined && mode !== '--allow-absent')) {
  throw new Error('usage: node scripts/check-crate-publication.mjs ARCHIVE [--allow-absent]');
}
const name = 'prism-calculator';
const version = '0.1.0';
const api = `https://crates.io/api/v1/crates/${name}/${version}`;
const url = `${api}/download`;
const headers = {'user-agent': 'PrismPM-Calculator-publication/1'};
const expected = readFileSync(archivePath);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expectedDigest = sha256(expected);
const metadataResponse = await fetch(api, {headers, redirect: 'error'});
if (metadataResponse.status === 404 && mode === '--allow-absent') {
  process.stdout.write(JSON.stringify({
    availability: 'absent',
    name,
    schema: 'calculator/crate-publication/1',
    status: 'passed',
    url,
    version,
  }));
  process.exit(0);
}
if (!metadataResponse.ok) throw new Error(`${api}: HTTP ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
if (metadata?.version?.crate !== name || metadata?.version?.num !== version ||
    !/^[0-9a-f]{64}$/.test(metadata?.version?.checksum ?? '')) {
  throw new Error('crates.io returned malformed version metadata');
}
if (metadata.version.checksum !== expectedDigest) {
  throw new Error('crates.io registry checksum differs from the exact generated archive');
}
const downloadResponse = await fetch(url, {headers, redirect: 'follow'});
if (!downloadResponse.ok) throw new Error(`${url}: HTTP ${downloadResponse.status}`);
const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
if (!downloaded.equals(expected)) {
  throw new Error('crates.io download differs byte-for-byte from the exact generated archive');
}
process.stdout.write(JSON.stringify({
  availability: 'present',
  name,
  registry_checksum_sha256: metadata.version.checksum,
  schema: 'calculator/crate-publication/1',
  sha256: expectedDigest,
  size: expected.length,
  status: 'passed',
  url,
  version,
}));
