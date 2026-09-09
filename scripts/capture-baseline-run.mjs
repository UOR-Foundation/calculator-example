#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { canonical, digest, evidenceSchema } from './baseline-evidence.mjs';

const separator = process.argv.indexOf('--');
if (separator < 0) throw new Error('usage: capture-baseline-run.mjs REPOSITORY REPEAT IMAGE OUTPUT -- COMMAND...');
const [repository, repeatText, image, output, ...unexpected] = process.argv.slice(2, separator);
const command = process.argv.slice(separator + 1);
if (unexpected.length || !repository || !repeatText || !image || !output || command.length === 0) throw new Error('usage: capture-baseline-run.mjs REPOSITORY REPEAT IMAGE OUTPUT -- COMMAND...');
if (!/^https:\/\/[^ ]+$/.test(repository) || !/^[12]$/.test(repeatText) || !/^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$/.test(image)) throw new Error('repository, repeat, or image binding is invalid');
if (process.env.PRISMPM_EXECUTION_IMAGE !== image) throw new Error('PRISMPM_EXECUTION_IMAGE must equal the exact image being recorded');
if (process.env.PRISMPM_EXECUTION_KIND !== 'devcontainer') throw new Error('PRISMPM_EXECUTION_KIND must be devcontainer');
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const commit = git('rev-parse', 'HEAD');
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('HEAD is not a full Git object ID');
const clean = () => git('status', '--porcelain=v1', '--untracked-files=all') === '';
if (!clean()) throw new Error('baseline command must start from a clean worktree');
const result = spawnSync(command[0], command.slice(1), {encoding: null, env: process.env, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
if (result.error) throw result.error;
const stdout = result.stdout ?? Buffer.alloc(0);
const stderr = result.stderr ?? Buffer.alloc(0);
const value = {
  command, commit, environment: {image, kind: 'devcontainer'}, exit_code: result.status,
  repeat: Number(repeatText), repository, schema: evidenceSchema,
  status: result.status === 0 ? 'passed' : 'failed',
  stderr: {base64: stderr.toString('base64'), sha256: digest(stderr), size: stderr.length},
  stdout: {base64: stdout.toString('base64'), sha256: digest(stdout), size: stdout.length},
  worktree: {clean_after: clean(), clean_before: true},
};
writeFileSync(output, canonical(value), {flag: 'wx', mode: 0o644});
process.stdout.write(`${digest(readFileSync(output))}  ${output}\n`);
if (result.status !== 0) process.exit(result.status ?? 1);
if (!value.worktree.clean_after) process.exitCode = 1;
