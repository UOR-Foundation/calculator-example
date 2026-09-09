import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const [checkedOn] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn ?? '')) {
  throw new Error('usage: node scripts/prepare-baseline.mjs YYYY-MM-DD');
}
if (new Date(`${checkedOn}T00:00:00Z`).toISOString().slice(0, 10) !== checkedOn) {
  throw new Error('baseline observation date is not a real calendar date');
}
if (!process.env.PRISMPM_SDK_INVENTORY) throw new Error('PRISMPM_SDK_INVENTORY is absent');
for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
  execFileSync('git', args, {stdio: 'inherit'});
}
if (execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {encoding: 'utf8'}).trim()) {
  throw new Error('prepare-baseline requires a clean committed projection input');
}
const releaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
if (!/^[0-9a-f]{40}$/.test(releaseCommit)) throw new Error('Git HEAD is not a full commit');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const field = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
};
const baselinePath = 'artifacts/calculator-baseline.json';
const baseline = readJson(baselinePath);
if (baseline.status !== 'unsealed') throw new Error('a sealed baseline cannot be prepared again');
const acceptance = readJson('artifacts/application-acceptance.json');
const view = readJson('artifacts/view-manifest.json');
const identities = {
  application_acceptance_sha256: sha256(readFileSync('artifacts/application-acceptance.json')),
  application_kappa: field(acceptance, 'holo.application_kappa'),
  archive_fingerprint: field(acceptance, 'holo.archive_fingerprint'),
  archive_kappa: field(acceptance, 'holo.archive_kappa'),
  build_id: acceptance.build_id,
  build_manifest_sha256: sha256(readFileSync('artifacts/build-manifest.json')),
  core_wasm_sha256: field(acceptance, 'core_wasm.sha256'),
  generated_core_sha256: view.generated_core_sha256,
  guest_content_kappa: field(acceptance, 'holo.guest_content_kappa'),
  holo_sha256: sha256(readFileSync('artifacts/Calculator.holo')),
  model_content_kappa: field(acceptance, 'holo.model_content_kappa'),
  model_id: sha256(readFileSync('artifacts/model.prism.json')),
  source_id: acceptance.source_id,
  source_sha256: sha256(readFileSync('src/Calculator.lex.tex')),
  view_content_kappa: field(acceptance, 'holo.view_content_kappa'),
  view_manifest_sha256: sha256(readFileSync('artifacts/view-manifest.json')),
  view_model_id: view.view_model_id,
};
if (Object.values(identities).some((value) => typeof value !== 'string' || value.length === 0)) {
  throw new Error('generated Calculator identity closure is incomplete');
}

const pagePaths = [
  'app.css',
  'app.js',
  'index.html',
  'prism_calculator.js',
  'prism_calculator_bg.wasm',
  'provenance.json',
];
const pagesPublication = JSON.parse(execFileSync('node', [
  'scripts/verify-pages-publication.mjs',
  'https://uor-foundation.github.io/calculator-example/',
  releaseCommit,
], {encoding: 'utf8'}));
if (pagesPublication.assets.map((asset) => asset.path).join('\n') !== pagePaths.join('\n')) {
  throw new Error('live Pages publication does not contain the exact generated closure');
}
const pages = {
  assets: pagesPublication.assets.map((asset) => ({
    committed_sha256: asset.sha256.slice(7),
    path: asset.path,
    served_sha256: asset.sha256.slice(7),
  })),
  checked_on: checkedOn,
  commit: releaseCommit,
  url: 'https://uor-foundation.github.io/calculator-example/',
};
baseline.formatting_correction.corrected_projection = {
  availability: 'present',
  checked_on: checkedOn,
  location: pagesPublication.corrected_projection.url,
  sha256: pagesPublication.corrected_projection.sha256.slice(7),
  size: pagesPublication.corrected_projection.size,
};
baseline.remediation.current_closure = {
  availability: 'present',
  identities,
  pages,
  release_commit: releaseCommit,
};
const stdlibRelease = readJson(join(dirname(process.env.PRISMPM_SDK_INVENTORY),
  'stdlib', 'release.json'));
if (stdlibRelease.schema !== 'prismpm/stdlib-release/1' ||
    !/^stdlib\/generated\/prism-stdlib-0\.2\.0\.crate$/.test(stdlibRelease.crate_path ?? '')) {
  throw new Error('SDK stdlib release identity is absent or malformed');
}
const localPackages = new Map([
  ['prism-calculator', readFileSync(
    `.prism/build/${acceptance.build_id}/cargo/prism-calculator-0.1.0.crate`)],
  ['prism-stdlib', readFileSync(join(dirname(process.env.PRISMPM_SDK_INVENTORY),
    stdlibRelease.crate_path))],
]);
if (sha256(localPackages.get('prism-stdlib')) !== stdlibRelease.crate_sha256) {
  throw new Error('SDK stdlib candidate disagrees with its release identity');
}
for (const publication of baseline.remediation.publications) {
  const url = `https://crates.io/api/v1/crates/${publication.name}/${publication.version}/download`;
  const response = await fetch(url, {
    headers: {'user-agent': 'PrismPM-Calculator-baseline/1'},
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = localPackages.get(publication.name);
  if (!local || !local.equals(bytes)) {
    throw new Error(`${publication.name} public crate differs from the exact local candidate`);
  }
  publication.public_registry = {
    availability: 'present',
    checked_on: checkedOn,
    location: url,
    sha256: sha256(bytes),
    size: bytes.length,
  };
}
const calculatorRows = baseline.verification_runs.filter(
  (row) => row.repository === 'https://github.com/UOR-Foundation/calculator-example',
);
if (calculatorRows.length !== 1 || calculatorRows[0].availability !== 'absent') {
  throw new Error('unsealed Calculator verification row is absent or ambiguous');
}
Object.assign(calculatorRows[0], {
  command: 'just baseline-input',
  evidence_digest: null,
  reason: 'The input-ready closure is committed; the explicit pre-seal gate has not run yet.',
});

const require = createRequire('/opt/prismpm/oracles/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const schemaPath = join(dirname(process.env.PRISMPM_SDK_INVENTORY), 'schemas',
  'calculator-baseline.schema.json');
const validate = new Ajv2020({allErrors: true, strict: true}).compile(readJson(schemaPath));
if (!validate(baseline)) throw new Error(`prepared baseline schema: ${JSON.stringify(validate.errors)}`);
writeFileSync(baselinePath, JSON.stringify(sorted(baseline)));

const checksumPaths = readFileSync('SHA256SUMS', 'utf8').trim().split('\n').map((line) =>
  line.slice(line.indexOf('  ') + 2));
writeFileSync('SHA256SUMS', `${checksumPaths.map((path) =>
  `${sha256(readFileSync(path))}  ${path}`).join('\n')}\n`);
process.stdout.write(`prepared input-ready Calculator baseline from ${releaseCommit}\n`);
