#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateCoverage } from './coverage-contract.mjs';

const authorities = {kind: 'present', ids: ['AUTH-ONE']};
const features = ['AU', 'DK', 'DP', 'LC', 'OC', 'OP', 'SC', 'SY', 'TM']
  .flatMap((suite, suiteIndex) => Array.from({length: suiteIndex === 0 ? 19 : 16},
    (_, index) => `${suite}-${String(index + 1).padStart(2, '0')}`))
  .slice(0, 147)
  .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  .map((feature_id) => ({
    command: `prismpm conformance --case ${feature_id}`,
    feature_id,
    generated_outputs: [`projections/capability-coverage.json#feature=${feature_id}`],
    model_source: `model/ids.toml#${feature_id}`,
    negative_evidence: `evidence/${feature_id}-negative.json`,
    negative_scenario: `${feature_id.toLowerCase()}-negative`,
    positive_evidence: `evidence/${feature_id}-positive.json`,
    positive_scenario: `${feature_id.toLowerCase()}-positive`,
    standard_authorities: structuredClone(authorities),
    statement: `Execute ${feature_id}`,
    suite: feature_id.slice(0, 2),
    visibility: 'public',
  }));
assert.equal(features.length, 147);
const diagnostics = Array.from({length: 83}, (_, index) => `PP${String(index + 1).padStart(4, '0')}`)
  .map((code) => ({
    class: 'input',
    code,
    command: `prismpm conformance --diagnostic ${code}`,
    evidence: `evidence/${code}.json`,
    generated_outputs: [`projections/capability-coverage.json#diagnostic=${code}`],
    model_source: `model/errors.toml#${code}`,
    scenario: `${code.toLowerCase()}-negative`,
    standard_authorities: {kind: 'none', reason: 'The diagnostic is Prism-owned composition policy.'},
    statement: `Reject ${code}`,
    visibility: 'public',
  }));
const positive = {
  diagnostics,
  features,
  model_digest: `sha256:${'a'.repeat(64)}`,
  schema: 'prismpm/capability-coverage/1',
};
const standards = {
  authorities: [{id: 'AUTH-ONE'}],
  schema: 'prismpm/standards-lock/1',
};
validateCoverage(positive, standards);
const reject = (name, mutate, pattern) => {
  const planted = structuredClone(positive);
  mutate(planted);
  assert.throws(() => validateCoverage(planted, standards), pattern, `${name} was accepted`);
};
reject('missing-link', (value) => { delete value.features[0].model_source; }, /missing or unknown/);
reject('unknown-link-field', (value) => { value.features[0].other_source = 'wrong'; }, /missing or unknown/);
reject('wrong-visibility', (value) => { value.features[0].visibility = 'internal'; }, /not public/);
reject('wrong-model-row', (value) => { value.features[0].model_source = 'model/ids.toml#SY-01'; }, /exact registered/);
reject('wrong-generated-row', (value) => { value.features[0].generated_outputs = ['output.json']; }, /exact projection/);
reject('unknown-authority', (value) => { value.features[0].standard_authorities.ids = ['AUTH-TWO']; }, /unknown authority/);
reject('open-authority', (value) => { value.features[0].standard_authorities.extra = true; }, /missing or unknown/);
reject('evasive-none', (value) => {
  value.diagnostics[0].standard_authorities.reason = 'Not applicable';
}, /evasive/);
reject('wrong-diagnostic-model-row', (value) => {
  value.diagnostics[0].model_source = 'model/errors.toml#PP9999';
}, /exact registered/);
reject('wrong-diagnostic-generated-row', (value) => {
  value.diagnostics[0].generated_outputs = ['output.json'];
}, /exact projection/);
process.stdout.write('coverage link positive and adversarial tests passed\n');
