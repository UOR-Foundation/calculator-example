#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(projectRoot, 'src', 'CalculatorSystem.lex.tex');
const semanticPrefix = '\\semanticdata{';
const semanticSuffix = '\n\\end{semanticmodule}';

function parseSource(source) {
  const start = source.indexOf(semanticPrefix);
  const end = source.indexOf(semanticSuffix, start);
  assert(start >= 0 && end > start, 'CalculatorSystem semantic module is absent');
  const jsonStart = start + semanticPrefix.length;
  return {
    document: JSON.parse(source.slice(jsonStart, end - 1)),
    end,
    jsonStart,
  };
}

function recordField(record, name) {
  assert.equal(record?.kind, 'record', `${name} parent is not a record`);
  const rows = record.fields.filter((row) => row.field === name);
  assert.equal(rows.length, 1, `expected exactly one ${name} field`);
  return rows[0];
}

function listHead(list, label) {
  assert.equal(list?.kind, 'cons', `${label} is empty`);
  return list.head;
}

function stringField(record, name) {
  const value = recordField(record, name).value;
  assert.equal(value?.kind, 'string', `${name} is not a string`);
  return value;
}

function systemModel(document) {
  const declarations = document.declarations.filter((row) => row.name === 'systemModelA');
  assert.equal(declarations.length, 1, 'expected exactly one systemModelA declaration');
  assert.equal(declarations[0].kind, 'definition', 'systemModelA is not a definition');
  return declarations[0].body;
}

function declaration(document, name) {
  const declarations = document.declarations.filter((row) => row.name === name);
  assert.equal(declarations.length, 1, `expected exactly one ${name} declaration`);
  return declarations[0];
}

function assertTheoremBinding(document, testCase, release) {
  const theoremName = testCase.theorem.replace('calculatorA', `calculator${release}`);
  const theorem = declaration(document, theoremName);
  assert.equal(theorem.kind, 'theorem', `${theoremName} is not a theorem`);
  assert.equal(theorem.proof?.kind, 'decide', `${theoremName} does not use decide`);
  assert.equal(theorem.statement?.kind, 'eq', `${theoremName} is not an equality`);
  assert.deepEqual(theorem.statement.right, { kind: 'bool', value: true },
    `${theoremName} does not establish true`);
  const invocation = theorem.statement.left;
  assert.equal(invocation?.kind, 'call', `${theoremName} does not invoke a validator`);
  assert.deepEqual(invocation.function,
    { module: 'Production.SystemValidation', name: testCase.predicate },
    `${theoremName} invokes the wrong validator`);
  assert.deepEqual(invocation.arguments?.map((argument) => argument.function?.name),
    [`systemModel${release}`, `systemManifest${release}`],
    `${theoremName} is not bound to the exact ${release} model and manifest`);
}

function listRecord(model, field, label = field) {
  return listHead(recordField(model, field).value, label);
}

function selfReference(list, value) {
  const prior = structuredClone(list);
  for (const key of Object.keys(list)) delete list[key];
  Object.assign(list, {
    head: { kind: 'string', value },
    kind: 'cons',
    tail: prior,
  });
}

const cases = [
  {
    family: 'closure',
    predicate: 'validateModelClosure',
    theorem: 'calculatorAClosureReady',
    mutate(model) {
      const artifact = listRecord(model, 'artifacts');
      listHead(recordField(artifact, 'platformRequirements').value,
        'artifact platform requirements').value = 'missing-platform-requirement';
    },
  },
  {
    family: 'uniqueness',
    predicate: 'validateModelUniqueness',
    theorem: 'calculatorAUniquenessReady',
    mutate(model) {
      const productId = stringField(recordField(model, 'product').value, 'id').value;
      stringField(listRecord(model, 'components'), 'id').value = productId;
    },
  },
  {
    family: 'referential-integrity',
    predicate: 'validateModelReferentialIntegrity',
    theorem: 'calculatorAReferentialIntegrityReady',
    mutate(model) {
      stringField(listRecord(model, 'interfaces'), 'document').value = 'missing-schema';
    },
  },
  {
    family: 'compatibility',
    predicate: 'validateModelCompatibility',
    theorem: 'calculatorACompatibilityReady',
    mutate(model) {
      stringField(listRecord(model, 'interfaces'), 'compatibility').value = 'unknown';
    },
  },
  {
    family: 'capability-satisfaction',
    predicate: 'validateModelCapabilitySatisfaction',
    theorem: 'calculatorACapabilitySatisfactionReady',
    mutate(model) {
      const component = listRecord(model, 'components');
      listHead(recordField(component, 'capabilities').value,
        'component capabilities').value = 'missing-capability';
    },
  },
  {
    family: 'secret-flow',
    predicate: 'validateModelSecretFlow',
    theorem: 'calculatorASecretFlowReady',
    mutate(model) {
      const secret = listRecord(model, 'secretReferences');
      listHead(recordField(secret, 'consumers').value,
        'secret consumers').value = 'missing-component';
    },
  },
  {
    family: 'deployment-order',
    predicate: 'validateModelDeploymentOrder',
    theorem: 'calculatorADeploymentOrderReady',
    mutate(model) {
      const component = listRecord(model, 'components');
      selfReference(recordField(component, 'dependsOn').value,
        stringField(component, 'id').value);
    },
  },
  {
    family: 'migration-order',
    predicate: 'validateModelMigrationOrder',
    theorem: 'calculatorAMigrationOrderReady',
    mutate(model) {
      const migration = listRecord(model, 'migrations');
      selfReference(recordField(migration, 'dependsOn').value,
        stringField(migration, 'id').value);
    },
  },
  {
    family: 'rollback-safety',
    predicate: 'validateModelRollbackSafety',
    theorem: 'calculatorARollbackSafetyReady',
    mutate(model) {
      stringField(listRecord(model, 'rollbacks'), 'kind').value = '';
    },
  },
  {
    family: 'evidence-closure',
    predicate: 'validateModelEvidenceClosure',
    theorem: 'calculatorAEvidenceClosureReady',
    mutate(model) {
      const bounded = recordField(listRecord(model, 'acceptance'), 'bounded').value;
      assert.equal(bounded?.kind, 'bool', 'acceptance bounded is not a Boolean');
      bounded.value = false;
    },
  },
  {
    family: 'license-closure',
    predicate: 'validateModelLicenseClosure',
    theorem: 'calculatorALicenseClosureReady',
    mutate(model) {
      stringField(listRecord(model, 'artifacts'), 'licenseExpression').value = '';
    },
  },
  {
    family: 'release-completeness',
    predicate: 'validateModelReleaseCompleteness',
    theorem: 'calculatorAReleaseCompletenessReady',
    mutate(model) {
      const supported = recordField(recordField(model, 'product').value,
        'supportedPlatforms').value;
      for (const key of Object.keys(supported)) delete supported[key];
      Object.assign(supported, { element: { kind: 'string' }, kind: 'nil' });
    },
  },
];

function writeSource(root, original, parsed, document) {
  const rendered = `${original.slice(0, parsed.jsonStart)}${JSON.stringify(document)}}` +
    original.slice(parsed.end);
  fs.writeFileSync(path.join(root, 'src', 'CalculatorSystem.lex.tex'), rendered);
}

function copyProject(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const file of [
    'lake-manifest.json', 'lakefile.toml', 'lean-toolchain', 'lexlean.lock', 'lexlean.toml',
  ]) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(root, file));
  }
  fs.copyFileSync(path.join(projectRoot, 'src', 'Calculator.lex.tex'),
    path.join(root, 'src', 'Calculator.lex.tex'));
  const inputs = path.join(projectRoot, '.prism', 'sdk', 'inputs');
  assert(fs.statSync(inputs).isDirectory(), 'locked SDK inputs have not been fetched');
  fs.cpSync(inputs, path.join(root, '.prism', 'sdk', 'inputs'), { recursive: true });
}

function verify(root) {
  return execFileSync('lexlean', [
    'verify', '--all', '--project', path.join(root, 'lexlean.toml'),
    '--diagnostic-format', 'human', '--color', 'never',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HOME: process.env.HOME ?? '/tmp' },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const original = fs.readFileSync(sourcePath, 'utf8');
const parsed = parseSource(original);
assert.equal(cases.length, 12);
assert.equal(new Set(cases.map((row) => row.family)).size, 12);
assert.equal(new Set(cases.map((row) => row.theorem)).size, 12);
for (const testCase of cases) {
  assertTheoremBinding(parsed.document, testCase, 'A');
  assertTheoremBinding(parsed.document, testCase, 'B');
}
for (const release of ['A', 'B']) {
  assertTheoremBinding(parsed.document, {
    predicate: 'validateManifest',
    theorem: 'calculatorASystemReleaseReady',
  }, release);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-formal-mutations.'));
try {
  const positiveRoot = path.join(temporary, 'positive');
  copyProject(positiveRoot);
  fs.copyFileSync(sourcePath, path.join(positiveRoot, 'src', 'CalculatorSystem.lex.tex'));
  verify(positiveRoot);

  for (const testCase of cases) {
    const root = path.join(temporary, testCase.family);
    copyProject(root);
    const document = structuredClone(parsed.document);
    const fixedManifest = JSON.stringify(declaration(document, 'systemManifestA'));
    const originalDocument = JSON.stringify(document);
    testCase.mutate(systemModel(document));
    assert.notEqual(JSON.stringify(document), originalDocument,
      `${testCase.family} did not change the authoritative model`);
    assert.equal(JSON.stringify(declaration(document, 'systemManifestA')), fixedManifest,
      `${testCase.family} changed systemManifestA`);
    writeSource(root, original, parsed, document);
    let failure;
    try {
      verify(root);
    } catch (error) {
      failure = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    }
    assert(failure, `${testCase.family} mutation was accepted`);
    assert(failure.includes('error[LLV7002]'),
      `${testCase.family} was rejected before Lean theorem verification: ${failure}`);
    const proposition = `Production.SystemValidation.${testCase.predicate} ` +
      'systemModelA systemManifestA = true';
    assert(failure.includes(proposition),
      `${testCase.family} failed outside ${testCase.theorem}: ${failure}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write('formal model mutation tests passed (12 validator families)\n');
