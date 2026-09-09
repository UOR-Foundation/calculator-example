import { createHash } from 'node:crypto';

const planPath = 'artifacts/historical-plan-05sep26.md';
const planTitle = 'PrismPM Holo/1 and Calculator completion plan';
const releasePath = 'artifacts/historical-release-candidate.json';
const releaseSchema = 'calculator-example/release-candidate/1';
const plainDigest = /^[0-9a-f]{64}$/;
const commit = /^[0-9a-f]{40}$/;

const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\n') !== [...keys].sort().join('\n')) {
    throw new Error(`${label} has missing or unknown fields`);
  }
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const equal = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label} does not match its preserved bytes`);
};

export function validateHistoricalRecords(record, readBytes) {
  const historical = record?.historical;
  if (!historical || typeof readBytes !== 'function') {
    throw new Error('historical baseline record or byte reader is absent');
  }
  const plan = historical.plan_record;
  exactKeys(plan, ['preserved_path', 'sha256', 'title'], 'historical plan_record');
  if (plan.preserved_path !== planPath || plan.title !== planTitle ||
      !plainDigest.test(plan.sha256 ?? '')) {
    throw new Error('historical plan_record identity is malformed');
  }
  const planBytes = readBytes(planPath);
  equal(sha(planBytes), plan.sha256, 'historical plan digest');
  if (!planBytes.toString('utf8').startsWith(`# ${planTitle}\n`)) {
    throw new Error('historical plan title does not match its preserved bytes');
  }

  const release = historical.release_candidate_record;
  exactKeys(release, [
    'hologram_live_commit', 'preserved_path', 'production_manifest_sha256', 'schema',
    'sha256', 'uor_hologram_commit', 'verification_manifest_sha256',
  ], 'historical release_candidate_record');
  if (release.preserved_path !== releasePath || release.schema !== releaseSchema ||
      !plainDigest.test(release.sha256 ?? '') ||
      !plainDigest.test(release.production_manifest_sha256 ?? '') ||
      !plainDigest.test(release.verification_manifest_sha256 ?? '') ||
      !commit.test(release.hologram_live_commit ?? '') ||
      !commit.test(release.uor_hologram_commit ?? '')) {
    throw new Error('historical release_candidate_record identity is malformed');
  }
  const releaseBytes = readBytes(releasePath);
  equal(sha(releaseBytes), release.sha256, 'historical release-candidate digest');
  let candidate;
  try {
    candidate = JSON.parse(releaseBytes);
  } catch {
    throw new Error('historical release-candidate bytes are not JSON');
  }
  equal(candidate.schema, release.schema, 'historical release-candidate schema');
  equal(candidate.dependencies?.hologram_live_commit, release.hologram_live_commit,
    'historical Hologram Live commit');
  equal(candidate.dependencies?.uor_hologram_commit, release.uor_hologram_commit,
    'historical UOR Hologram commit');
  equal(candidate.application_acceptance?.verification_manifest_sha256,
    release.verification_manifest_sha256, 'historical verification manifest');
  equal(candidate.pages?.production_manifest_sha256,
    release.production_manifest_sha256, 'historical Pages aggregate');
  return { candidate, planBytes, releaseBytes };
}
