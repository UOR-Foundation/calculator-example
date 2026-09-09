#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest, evidenceSchema, expectedRuns, validateEvidence, validateEvidenceSet } from './baseline-evidence.mjs';

const image = `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);
const transcript = (text) => { const bytes = Buffer.from(text); return {base64: bytes.toString('base64'), sha256: digest(bytes), size: bytes.length}; };
const make = (expected, overrides = {}) => Buffer.from(canonical({
  command: [...expected.command], commit, environment: {image, kind: 'devcontainer'}, exit_code: 0,
  repeat: expected.repeat, repository: expected.repository, schema: evidenceSchema, status: 'passed',
  stderr: transcript(''), stdout: transcript('verified\n'), worktree: {clean_after: true, clean_before: true}, ...overrides,
}));
const entries = new Map(expectedRuns.map((expected) => [expected.filename, make(expected)]));
assert.equal(validateEvidenceSet(entries, image, commit).length, 5);
const rejects = (raw, expected, pattern) => assert.throws(() => validateEvidence(raw, expected, image), pattern);
const first = expectedRuns[0];
rejects(Buffer.concat([make(first), Buffer.from('\n')]), first, /not canonical/);
rejects(make(first, {extra: true}), first, /missing or extra/);
rejects(make(first, {exit_code: 1, status: 'failed'}), first, /not a passing/);
rejects(make(first, {command: ['just', 'ci']}), first, /does not match/);
rejects(make(first, {commit: 'main'}), first, /full Git object/);
rejects(make(first, {environment: {image: `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'c'.repeat(64)}`, kind: 'devcontainer'}}), first, /stale or different/);
rejects(make(first, {worktree: {clean_after: false, clean_before: true}}), first, /clean source/);
const badTranscript = transcript('verified\n'); badTranscript.sha256 = `sha256:${'0'.repeat(64)}`;
rejects(make(first, {stdout: badTranscript}), first, /digest does not agree/);
const missing = new Map(entries); missing.delete(first.filename);
assert.throws(() => validateEvidenceSet(missing, image, commit), /missing or extra/);
const extra = new Map(entries); extra.set('unexpected.json', make(first));
assert.throws(() => validateEvidenceSet(extra, image, commit), /missing or extra/);
assert.throws(() => validateEvidenceSet(entries, image, 'c'.repeat(40)), /exact current input commit/);
const splitRepeat = new Map(entries);
splitRepeat.set('prismpm-2.json', make(expectedRuns[1], {commit: 'c'.repeat(40)}));
assert.throws(() => validateEvidenceSet(splitRepeat, image, commit), /different commits/);

const repository = mkdtempSync(join(tmpdir(), 'calculator-baseline-capture.'));
const fakeBin = mkdtempSync(join(tmpdir(), 'calculator-baseline-bin.'));
try {
  const git = (...args) => execFileSync('git', args, {cwd: repository, stdio: 'ignore'});
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Calculator baseline test');
  writeFileSync(join(repository, 'input'), 'fixed\n');
  git('add', 'input');
  git('commit', '--quiet', '-m', 'fixture');
  const output = join(tmpdir(), `calculator-baseline-capture-${process.pid}.json`);
  const capture = new URL('./capture-baseline-run.mjs', import.meta.url).pathname;
  writeFileSync(join(fakeBin, 'just'), '#!/bin/sh\ntest "$1" = vv\nprintf "captured\\n"\n');
  chmodSync(join(fakeBin, 'just'), 0o755);
  const result = spawnSync(process.execPath, [
    capture, first.repository, '1', image, output, '--', 'just', 'vv',
  ], {cwd: repository, encoding: 'utf8', env: {...process.env, PATH: `${fakeBin}:${process.env.PATH}`, PRISMPM_EXECUTION_IMAGE: image, PRISMPM_EXECUTION_KIND: 'devcontainer'}});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(validateEvidence(readFileSync(output), first, image).stdout.base64,
    Buffer.from('captured\n').toString('base64'));
  rmSync(output);

  writeFileSync(join(repository, 'dirty'), 'not committed\n');
  const dirty = spawnSync(process.execPath, [
    capture, first.repository, '1', image, output, '--', 'just', 'vv',
  ], {cwd: repository, encoding: 'utf8', env: {...process.env, PATH: `${fakeBin}:${process.env.PATH}`, PRISMPM_EXECUTION_IMAGE: image, PRISMPM_EXECUTION_KIND: 'devcontainer'}});
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /clean worktree/);
} finally {
  rmSync(repository, {force: true, recursive: true});
  rmSync(fakeBin, {force: true, recursive: true});
}
process.stdout.write('baseline evidence positive and adversarial tests passed\n');
