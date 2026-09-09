import assert from 'node:assert/strict';

const runtimeReference =
  /^ghcr\.io\/uor-foundation\/prismpm-runtime@(sha256:[0-9a-f]{64})$/;

function field(record, name) {
  assert.equal(record?.kind, 'record', `${name} parent is not a record`);
  const matches = record.fields.filter((row) => row.field === name);
  assert.equal(matches.length, 1, `expected exactly one ${name} field`);
  return matches[0].value;
}

function list(value, label) {
  const rows = [];
  let cursor = value;
  while (cursor?.kind === 'cons') {
    rows.push(cursor.head);
    cursor = cursor.tail;
  }
  assert.equal(cursor?.kind, 'nil', `${label} is not a closed list`);
  return rows;
}

export function parseSemanticSource(source) {
  const prefix = '\\semanticdata{';
  const suffix = '\n\\end{semanticmodule}';
  const start = source.indexOf(prefix);
  const end = source.indexOf(suffix, start);
  assert(start >= 0 && end > start, 'CalculatorSystem semantic module is absent');
  const jsonStart = start + prefix.length;
  return {
    document: JSON.parse(source.slice(jsonStart, end - 1)),
    end,
    jsonStart,
  };
}

export function bindRuntimeReference(source, reference) {
  const match = runtimeReference.exec(reference);
  assert(match, 'runtime reference must be the public PrismPM runtime at an exact SHA-256 digest');
  const parsed = parseSemanticSource(source);
  const models = parsed.document.declarations.filter(
    (row) => row.kind === 'definition' && /^systemModel[AB]$/.test(row.name ?? ''),
  );
  assert.deepEqual(models.map((row) => row.name), ['systemModelA', 'systemModelB'],
    'expected exactly the authoritative A and B system models');

  const prior = [];
  for (const model of models) {
    const artifacts = list(field(model.body, 'artifacts'), `${model.name}.artifacts`);
    const runtime = artifacts.filter((artifact) => field(artifact, 'id').value === 'runtime-image');
    assert.equal(runtime.length, 1, `${model.name} must contain exactly one runtime-image artifact`);
    const path = field(runtime[0], 'path');
    const digest = field(runtime[0], 'digest');
    assert.equal(path?.kind, 'string', `${model.name} runtime path is not a string`);
    assert.equal(digest?.kind, 'string', `${model.name} runtime digest is not a string`);
    assert(/^sha256:[0-9a-f]{64}$/.test(digest.value ?? ''),
      `${model.name} runtime digest is not an exact SHA-256 digest`);
    prior.push(`${path.value}@${digest.value}`);
    path.value = 'ghcr.io/uor-foundation/prismpm-runtime';
    digest.value = match[1];
  }
  assert.equal(new Set(prior).size, 1, 'A and B do not start from one runtime artifact identity');

  const json = JSON.stringify(parsed.document);
  const rendered = `${source.slice(0, parsed.jsonStart)}${json}}${source.slice(parsed.end)}`;
  const rebound = parseSemanticSource(rendered);
  for (const model of rebound.document.declarations.filter(
    (row) => row.kind === 'definition' && /^systemModel[AB]$/.test(row.name ?? ''),
  )) {
    const runtime = list(field(model.body, 'artifacts'), `${model.name}.artifacts`)
      .filter((artifact) => field(artifact, 'id').value === 'runtime-image');
    assert.equal(runtime.length, 1);
    assert.equal(field(runtime[0], 'path').value, 'ghcr.io/uor-foundation/prismpm-runtime');
    assert.equal(field(runtime[0], 'digest').value, match[1]);
  }
  return rendered;
}
