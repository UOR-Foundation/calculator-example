#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateHistoricalRecords } from './historical-baseline.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const planPath = 'artifacts/historical-plan-05sep26.md';
const releasePath = 'artifacts/historical-release-candidate.json';
const plan = Buffer.from('# PrismPM Holo/1 and Calculator completion plan\nfixed\n');
const candidate = {
  application_acceptance: { verification_manifest_sha256: 'a'.repeat(64) },
  dependencies: { hologram_live_commit: 'b'.repeat(40), uor_hologram_commit: 'c'.repeat(40) },
  pages: { production_manifest_sha256: 'd'.repeat(64) },
  schema: 'calculator-example/release-candidate/1',
};
const release = Buffer.from(JSON.stringify(candidate));
const value = {
  historical: {
    plan_record: {
      preserved_path: planPath,
      sha256: sha(plan),
      title: 'PrismPM Holo/1 and Calculator completion plan',
    },
    release_candidate_record: {
      hologram_live_commit: 'b'.repeat(40),
      preserved_path: releasePath,
      production_manifest_sha256: 'd'.repeat(64),
      schema: 'calculator-example/release-candidate/1',
      sha256: sha(release),
      uor_hologram_commit: 'c'.repeat(40),
      verification_manifest_sha256: 'a'.repeat(64),
    },
  },
};
const bytes = new Map([[planPath, plan], [releasePath, release]]);
const validate = (subject = value, source = bytes) =>
  validateHistoricalRecords(subject, (path) => source.get(path));
assert.equal(validate().candidate.schema, candidate.schema);
const reject = (name, mutate) => {
  const planted = structuredClone(value);
  mutate(planted);
  assert.throws(() => validate(planted), undefined, `${name} was accepted`);
};
reject('missing-plan-field', (row) => { delete row.historical.plan_record.title; });
reject('unknown-plan-field', (row) => { row.historical.plan_record.extra = true; });
reject('wrong-plan-path', (row) => { row.historical.plan_record.preserved_path = '../plan.md'; });
reject('wrong-plan-digest', (row) => { row.historical.plan_record.sha256 = 'e'.repeat(64); });
reject('wrong-plan-title', (row) => { row.historical.plan_record.title = 'Different plan'; });
reject('missing-release-field', (row) => {
  delete row.historical.release_candidate_record.verification_manifest_sha256;
});
reject('unknown-release-field', (row) => { row.historical.release_candidate_record.extra = true; });
reject('wrong-release-path', (row) => {
  row.historical.release_candidate_record.preserved_path = 'artifacts/other.json';
});
reject('wrong-release-schema', (row) => {
  row.historical.release_candidate_record.schema = 'calculator-example/release-candidate/2';
});
reject('wrong-release-digest', (row) => {
  row.historical.release_candidate_record.sha256 = 'e'.repeat(64);
});
reject('wrong-nested-hologram-live-commit', (row) => {
  row.historical.release_candidate_record.hologram_live_commit = 'e'.repeat(40);
});
reject('wrong-nested-uor-hologram-commit', (row) => {
  row.historical.release_candidate_record.uor_hologram_commit = 'e'.repeat(40);
});
reject('wrong-nested-verification-manifest', (row) => {
  row.historical.release_candidate_record.verification_manifest_sha256 = 'e'.repeat(64);
});
reject('wrong-nested-pages-aggregate', (row) => {
  row.historical.release_candidate_record.production_manifest_sha256 = 'e'.repeat(64);
});
const tampered = new Map(bytes);
tampered.set(releasePath, Buffer.concat([release, Buffer.from('\n')]));
assert.throws(() => validate(value, tampered), undefined, 'tampered release bytes were accepted');
process.stdout.write('historical baseline record adversarial tests passed\n');
