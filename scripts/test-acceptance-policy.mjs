#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAcceptanceDispatch, validateRepositoryAcceptance} from './acceptance-policy.mjs';

const source = readFileSync('scripts/acceptance.sh', 'utf8');
validateAcceptanceDispatch(source);
const repositoryGate = readFileSync('scripts/verify.sh', 'utf8');
validateRepositoryAcceptance(repositoryGate);
const omit = (name, needle) => {
  const planted = source.replace(needle, '');
  assert.notEqual(planted, source, `${name} defect was not planted`);
  assert.throws(() => validateAcceptanceDispatch(planted), /omits a required suite/,
    `${name} omission was accepted`);
};
omit('protected-conformance', '    conformance_acceptance\n    ;;\n  all)');
omit('full-conformance', '    conformance_acceptance\n    roundtrip_acceptance');
omit('public-pages', '    pages_acceptance\n    compose_acceptance');
omit('ghcr-roundtrip', '    roundtrip_acceptance\n    ;;\nesac');
assert.throws(() => validateRepositoryAcceptance(repositoryGate.replace(
  './scripts/acceptance.sh system "$mode"',
  './scripts/acceptance.sh compose "$mode"\n./scripts/acceptance.sh conformance "$mode"')),
/complete protected system dispatch/, 'external-image/Kind omission was accepted');
process.stdout.write('acceptance dispatch positive and adversarial tests passed\n');
