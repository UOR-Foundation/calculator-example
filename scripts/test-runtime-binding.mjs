#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindRuntimeReference, parseSemanticSource} from './runtime-binding.mjs';

const source = readFileSync('src/CalculatorSystem.lex.tex', 'utf8');
const reference = `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'a'.repeat(64)}`;
const candidate = bindRuntimeReference(source,
  `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'b'.repeat(64)}`);
const rendered = bindRuntimeReference(candidate, reference);
assert.equal(bindRuntimeReference(rendered, reference), rendered, 'runtime binding is not idempotent');
assert.notEqual(rendered, candidate, 'positive runtime binding did not update the prior reference');

assert.throws(() => bindRuntimeReference(source,
  `localhost:5000/prismpm-runtime@sha256:${'a'.repeat(64)}`), /public PrismPM runtime/);
assert.throws(() => bindRuntimeReference(source,
  `ghcr.io/uor-foundation/prismpm-runtime:latest@sha256:${'a'.repeat(64)}`),
/public PrismPM runtime/);

const parsed = parseSemanticSource(source);
const plantedDocument = structuredClone(parsed.document);
const modelB = plantedDocument.declarations.find((row) => row.name === 'systemModelB');
const artifacts = modelB.body.fields.find((row) => row.field === 'artifacts').value;
const runtime = [];
for (let cursor = artifacts; cursor?.kind === 'cons'; cursor = cursor.tail) {
  const id = cursor.head.fields.find((row) => row.field === 'id')?.value?.value;
  if (id === 'runtime-image') runtime.push(cursor.head);
}
assert.equal(runtime.length, 1);
runtime[0].fields.find((row) => row.field === 'digest').value.value = `sha256:${'b'.repeat(64)}`;
const planted = `${source.slice(0, parsed.jsonStart)}${JSON.stringify(plantedDocument)}}` +
  source.slice(parsed.end);
assert.throws(() => bindRuntimeReference(planted, reference), /do not start from one runtime/);

process.stdout.write('runtime binding positive and adversarial tests passed\n');
