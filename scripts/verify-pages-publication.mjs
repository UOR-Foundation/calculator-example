import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [baseInput, commit] = process.argv.slice(2);
if (!/^https:\/\/[^ ]+$/.test(baseInput ?? '')) throw new Error('Pages URL is not HTTPS');
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Pages commit is not a full Git identity');
const base = new URL(baseInput.endsWith('/') ? baseInput : `${baseInput}/`);
const githubHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'PrismPM-Calculator-Pages/1',
  'x-github-api-version': '2022-11-28',
};
const deploymentsUrl = new URL(
  'https://api.github.com/repos/UOR-Foundation/calculator-example/deployments',
);
deploymentsUrl.searchParams.set('environment', 'github-pages');
deploymentsUrl.searchParams.set('sha', commit);
deploymentsUrl.searchParams.set('per_page', '100');
const deploymentsResponse = await fetch(deploymentsUrl, {
  headers: githubHeaders,
  redirect: 'error',
});
if (!deploymentsResponse.ok) {
  throw new Error(`${deploymentsUrl}: HTTP ${deploymentsResponse.status}`);
}
const deployments = await deploymentsResponse.json();
if (!Array.isArray(deployments)) throw new Error('GitHub deployments response is not an array');
const exactDeployments = deployments.filter((deployment) =>
  deployment?.sha === commit &&
  deployment?.environment === 'github-pages' &&
  Number.isSafeInteger(deployment?.id) &&
  /^https:\/\/api\.github\.com\/repos\/UOR-Foundation\/calculator-example\/deployments\/[0-9]+\/statuses$/.test(
    deployment?.statuses_url ?? '',
  ));
if (exactDeployments.length === 0) {
  throw new Error(`GitHub has no Pages deployment for exact commit ${commit}`);
}
let successfulDeployment;
for (const deployment of exactDeployments) {
  const statusesResponse = await fetch(`${deployment.statuses_url}?per_page=100`, {
    headers: githubHeaders,
    redirect: 'error',
  });
  if (!statusesResponse.ok) {
    throw new Error(`${deployment.statuses_url}: HTTP ${statusesResponse.status}`);
  }
  const statuses = await statusesResponse.json();
  if (!Array.isArray(statuses)) throw new Error('GitHub deployment statuses response is not an array');
  const success = statuses.find((status) =>
    status?.state === 'success' &&
    status?.environment_url &&
    new URL(status.environment_url).href === base.href);
  if (success) {
    successfulDeployment = {deployment, success};
    break;
  }
}
if (!successfulDeployment) {
  throw new Error(`GitHub has no successful Pages deployment for exact commit ${commit}`);
}
const paths = [
  'app.css',
  'app.js',
  'index.html',
  'prism_calculator.js',
  'prism_calculator_bg.wasm',
  'provenance.json',
];
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const assets = [];
for (const path of paths) {
  const local = readFileSync(`public/${path}`);
  const url = new URL(path, base);
  const response = await fetch(url, {
    headers: {
      'cache-control': 'no-cache',
      'user-agent': 'PrismPM-Calculator-Pages/1',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const served = Buffer.from(await response.arrayBuffer());
  if (!local.equals(served)) throw new Error(`live Pages byte differs: ${path}`);
  assets.push({path, sha256: sha256(served), size: served.length});
}
const index = assets.find((asset) => asset.path === 'index.html');
process.stdout.write(JSON.stringify({
  assets,
  commit,
  corrected_projection: {
    path: index.path,
    sha256: index.sha256,
    size: index.size,
    url: new URL(index.path, base).href,
  },
  deployment: {
    created_at: successfulDeployment.deployment.created_at,
    id: successfulDeployment.deployment.id,
    status_created_at: successfulDeployment.success.created_at,
  },
  schema: 'calculator/pages-publication/1',
  status: 'passed',
  url: base.href,
}));
