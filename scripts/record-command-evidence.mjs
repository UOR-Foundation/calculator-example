#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [output, exitText, diagnostic, stdoutPath, stderrPath, ...command] = process.argv.slice(2);
if (!output || !exitText || !diagnostic || !stdoutPath || !stderrPath || command.length === 0) {
  throw new Error('usage: record-command-evidence.mjs OUTPUT EXIT DIAGNOSTIC STDOUT STDERR COMMAND...');
}
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const stdout = await readFile(stdoutPath);
const stderr = await readFile(stderrPath);
const document = {
  command,
  diagnostic,
  exit_code: Number(exitText),
  schema: 'calculator/command-evidence/1',
  status: 'passed',
  stderr_digest: digest(stderr),
  stdout_digest: digest(stdout)
};
await writeFile(output, canonical(document));
