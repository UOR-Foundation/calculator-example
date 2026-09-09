#!/usr/bin/env node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical, digest, expectedRuns, validateEvidenceSet } from './baseline-evidence.mjs';

const [inputDirectory] = process.argv.slice(2);
if (!inputDirectory || process.argv.length !== 3) throw new Error('usage: node scripts/seal-baseline.mjs EVIDENCE_DIRECTORY');
if (!process.env.PRISMPM_SDK_INVENTORY) throw new Error('PRISMPM_SDK_INVENTORY is absent');
for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) execFileSync('git', args, {stdio: 'inherit'});
if (execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {encoding: 'utf8'}).trim()) throw new Error('baseline sealing requires the clean committed input-ready closure');
const calculatorCommit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const baselinePath = 'artifacts/calculator-baseline.json';
const checksumPath = 'SHA256SUMS';
const outputDirectory = 'artifacts/baseline-evidence';
if (!lstatSync(inputDirectory).isDirectory()) throw new Error('evidence input is not a directory');
if (readdirSync(inputDirectory, {withFileTypes: true}).some((entry) => !entry.isFile())) throw new Error('evidence input contains a non-file entry');
const entries = new Map(readdirSync(inputDirectory).map((name) => {
  const path = join(inputDirectory, name);
  if (!lstatSync(path).isFile()) throw new Error(`evidence input is not a regular file: ${name}`);
  return [name, readFileSync(path)];
}));
const lock = JSON.parse(readFileSync('prismpm.lock', 'utf8'));
const sdkImage = lock.sdk_image;
if (!/^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$/.test(sdkImage ?? '')) throw new Error('prismpm.lock does not bind an exact SDK manifest digest');
const evidence = validateEvidenceSet(entries, sdkImage, calculatorCommit);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
if (baseline.status !== 'unsealed' || baseline.remediation?.current_closure?.availability !== 'present' || !baseline.remediation.publications.every((row) => row.public_registry.availability === 'present')) throw new Error('Calculator baseline is not the complete input-ready unsealed record');
for (const expected of expectedRuns) {
  const value = evidence.find(({repository, repeat}) => repository === expected.repository && repeat === expected.repeat);
  const row = baseline.verification_runs.find(({repository, repeat}) => repository === expected.repository && repeat === expected.repeat);
  if (!row || !value) throw new Error(`baseline row is absent for ${expected.filename}`);
  Object.assign(row, {availability: 'present', command: expected.command.join(' '), evidence_digest: digest(entries.get(expected.filename)), reason: 'The exact clean SDK execution evidence is committed under artifacts/baseline-evidence.'});
  const repository = baseline.repositories.find((candidate) => candidate.repository === expected.repository);
  if (!repository) throw new Error(`baseline repository is absent for ${expected.repository}`);
  repository.commit = value.commit;
}
baseline.status = 'sealed';

const require = createRequire('/opt/prismpm/oracles/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const schemaPath = join(dirname(process.env.PRISMPM_SDK_INVENTORY), 'schemas', 'calculator-baseline.schema.json');
const validate = new Ajv2020({allErrors: true, strict: true}).compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
if (!validate(baseline)) throw new Error(`sealed baseline schema: ${JSON.stringify(validate.errors)}`);
const baselineBytes = Buffer.from(canonical(baseline));
const checksumPaths = readFileSync(checksumPath, 'utf8').trim().split('\n')
  .map((line) => line.slice(line.indexOf('  ') + 2))
  .filter((path) => !path.startsWith(`${outputDirectory}/`));
for (const {filename} of expectedRuns) checksumPaths.push(`${outputDirectory}/${filename}`);
checksumPaths.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
const bytesFor = (path) => path === baselinePath ? baselineBytes : path.startsWith(`${outputDirectory}/`) ? entries.get(path.slice(outputDirectory.length + 1)) : readFileSync(path);
const checksumBytes = Buffer.from(`${checksumPaths.map((path) => `${digest(bytesFor(path)).slice(7)}  ${path}`).join('\n')}\n`);

const temporary = `artifacts/.baseline-seal-${process.pid}`;
mkdirSync(temporary, {mode: 0o700});
try {
  mkdirSync(join(temporary, 'baseline-evidence'), {mode: 0o755});
  for (const {filename} of expectedRuns) writeFileSync(join(temporary, 'baseline-evidence', filename), entries.get(filename), {mode: 0o644});
  writeFileSync(join(temporary, 'calculator-baseline.json'), baselineBytes, {mode: 0o644});
  writeFileSync(join(temporary, 'SHA256SUMS'), checksumBytes, {mode: 0o644});
  copyFileSync(checksumPath, join(temporary, 'SHA256SUMS.previous'));
  try { lstatSync(outputDirectory); throw new Error(`${outputDirectory} already exists; a sealed baseline cannot be overwritten`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let evidenceInstalled = false;
  let checksumInstalled = false;
  try {
    // The baseline status is the transaction commit marker. Install its exact
    // evidence and checksum first, then atomically replace the record last;
    // no reader can observe a sealed record that names absent inputs.
    renameSync(join(temporary, 'baseline-evidence'), outputDirectory);
    evidenceInstalled = true;
    renameSync(join(temporary, 'SHA256SUMS'), checksumPath);
    checksumInstalled = true;
    renameSync(join(temporary, 'calculator-baseline.json'), baselinePath);
  } catch (error) {
    if (checksumInstalled) renameSync(join(temporary, 'SHA256SUMS.previous'), checksumPath);
    if (evidenceInstalled) rmSync(outputDirectory, {force: true, recursive: true});
    throw error;
  }
} finally {
  rmSync(temporary, {force: true, recursive: true});
}
process.stdout.write(`${digest(baselineBytes)}  ${baselinePath}\n`);
