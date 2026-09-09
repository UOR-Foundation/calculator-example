#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateTargetPolicies } from './target-policy.mjs';

const targets = [
  {id: 'compose-local', minimum_release_status: 'development'},
  {id: 'github-pages', minimum_release_status: 'accepted'},
  {id: 'kubernetes-kind', minimum_release_status: 'development'},
];
validateTargetPolicies(targets);
const reject = (name, mutate, pattern) => {
  const planted = structuredClone(targets);
  mutate(planted);
  assert.throws(() => validateTargetPolicies(planted), pattern, `${name} was accepted`);
};
reject('missing', (value) => { delete value[0].minimum_release_status; }, /omits/);
reject('invalid', (value) => { value[0].minimum_release_status = 'unsigned'; }, /invalid/);
reject('reduced-public-policy', (value) => {
  value[1].minimum_release_status = 'development';
}, /weakens or changes/);
reject('invented-provider', (value) => {
  value[2].id = 'production-cloud';
}, /unknown or duplicated/);
process.stdout.write('target release-policy positive and adversarial tests passed\n');
