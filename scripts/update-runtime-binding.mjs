#!/usr/bin/env node
import {readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {bindRuntimeReference} from './runtime-binding.mjs';

const [reference, sourcePath = 'src/CalculatorSystem.lex.tex'] = process.argv.slice(2);
if (!reference) throw new Error('usage: update-runtime-binding.mjs RUNTIME_IMAGE@sha256:DIGEST [SOURCE]');

const source = readFileSync(sourcePath, 'utf8');
const rendered = bindRuntimeReference(source, reference);
if (rendered !== source) {
  const temporary = join(dirname(sourcePath), `.CalculatorSystem.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, rendered, {encoding: 'utf8', mode: 0o644, flag: 'wx'});
    renameSync(temporary, sourcePath);
  } finally {
    rmSync(temporary, {force: true});
  }
}
