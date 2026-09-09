import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = '.prism/repository-evidence';
const output = 'baseline-input.json';
if (!process.env.PRISMPM_SDK_INVENTORY) {
  throw new Error('PRISMPM_SDK_INVENTORY is absent');
}
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const entries = readdirSync(directory, { withFileTypes: true });
if (entries.some((entry) => entry.name !== output && !entry.isFile())) {
  throw new Error('baseline input evidence contains a non-file entry');
}
const files = entries
  .filter((entry) => entry.isFile() && entry.name !== output)
  .map((entry) => entry.name)
  .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
if (files.length === 0) throw new Error('baseline input produced no evidence');
const evidence = files.map((path) => ({
  path,
  sha256: sha256(readFileSync(join(directory, path))),
}));
const record = {
  baseline_sha256: sha256(readFileSync('artifacts/calculator-baseline.json')),
  command: 'just baseline-input',
  evidence,
  prismpm_lock_sha256: sha256(readFileSync('prismpm.lock')),
  schema: 'calculator/baseline-input-evidence/1',
  sdk_inventory_sha256: sha256(readFileSync(process.env.PRISMPM_SDK_INVENTORY)),
  standards_lock_sha256: sha256(readFileSync('standards.lock')),
  status: 'passed',
  template_lock_sha256: sha256(readFileSync('template.lock')),
};
const bytes = Buffer.from(JSON.stringify(record));
writeFileSync(join(directory, output), bytes);
process.stdout.write(`${sha256(bytes)}  ${directory}/${output}\n`);
