#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const baseUrl = process.env.CALCULATOR_PRODUCTION_URL ?? 'https://127.0.0.1:8080';
const expectedRelease = process.env.CALCULATOR_EXPECTED_RELEASE ?? 'B';
assert.match(expectedRelease, /^(?:A|B)$/);
const faultTarget = process.env.CALCULATOR_VIEW_FAULT_TARGET ?? '';
const composeProject = process.env.CALCULATOR_VIEW_COMPOSE_PROJECT ?? '';
assert.match(faultTarget, /^(?:|compose|kind)$/);
if (faultTarget === 'compose') assert.match(composeProject, /^[a-z0-9][a-z0-9_-]*$/);

function command(program, args) {
  return execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function composeDatabaseContainer() {
  const containers = command('docker', [
    'ps',
    '--filter', `label=com.docker.compose.project=${composeProject}`,
    '--filter', 'label=com.docker.compose.service=database',
    '--format', '{{.ID}}',
  ]).split('\n').filter(Boolean);
  assert.equal(containers.length, 1, `expected exactly one running ${composeProject} database container`);
  return containers[0];
}

function stopDatabase() {
  if (faultTarget === 'compose') {
    const container = composeDatabaseContainer();
    command('docker', ['stop', container]);
    return container;
  }
  command('kubectl', ['--namespace', 'calculator-system', 'scale', 'statefulset/database', '--replicas=0']);
  command('kubectl', [
    '--namespace', 'calculator-system', 'wait', '--for=delete',
    'pod/database-0', '--timeout=120s',
  ]);
  return 'statefulset/database';
}

async function startDatabase(identity) {
  if (faultTarget === 'compose') {
    command('docker', ['start', identity]);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const health = command('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', identity]);
      if (health === 'healthy') return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.fail(`database container ${identity} did not become healthy`);
  }
  command('kubectl', ['--namespace', 'calculator-system', 'scale', 'statefulset/database', '--replicas=1']);
  command('kubectl', [
    '--namespace', 'calculator-system', 'rollout', 'status',
    'statefulset/database', '--timeout=120s',
  ]);
}
const resolver = process.env.CALCULATOR_CONNECT_ADDRESS;
const browser = await chromium.launch({
  args: resolver ? [`--host-resolver-rules=MAP calculator.local ${resolver}`, '--no-proxy-server'] : [],
  headless: true,
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(await page.title(), 'Calculator system');
  assert.equal(await page.locator('#release').textContent(), `Release ${expectedRelease}`);
  assert.equal(await page.locator('#history').isHidden(), true);
  const commandSection = page.locator('#command,#calculator');
  assert.equal(await commandSection.isHidden(), true);
  assert.equal((await new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21aa',
    'wcag22aa'
  ]).analyze()).violations.length, 0);

  await page.locator('#subject').fill('view-user');
  await page.locator('#role').selectOption('calculator.user');
  await Promise.all([
    page.locator('#status').filter({ hasText: /^Authenticating…$/ }).waitFor({ state: 'visible' }),
    page.locator('#login button').click(),
  ]);
  await page.locator('#history').waitFor({ state: 'visible' });
  assert.equal(await commandSection.isVisible(), true);
  assert.equal(await page.locator('#empty').isVisible(), true);
  const requestId = `view-${expectedRelease.toLowerCase()}-${process.pid}`;
  await page.getByLabel('Request ID').fill(requestId);
  await page.getByLabel('Left operand').fill('7');
  await page.getByLabel('Operation').selectOption('multiply');
  await page.getByLabel('Right operand').fill('6');
  if (expectedRelease === 'B') await page.getByLabel('Client label').fill('Cafe\u0301');
  await Promise.all([
    page.locator('#status').filter({ hasText: /^Calculating…$/ }).waitFor({ state: 'visible' }),
    page.getByRole('button', { name: 'Calculate', exact: true }).click(),
  ]);
  const row = page.locator('#records tr').filter({ hasText: requestId });
  await row.waitFor({ state: 'visible' });
  assert.match(await row.textContent(), /7 multiply 6/);
  assert.match(await row.textContent(), /42/);
  if (expectedRelease === 'B') assert.match(await row.textContent(), /Café/);

  const rejectedId = `${requestId}-rejected`;
  await page.getByLabel('Request ID').fill(rejectedId);
  await page.getByLabel('Left operand').fill('1');
  await page.getByLabel('Operation').selectOption('divide');
  await page.getByLabel('Right operand').fill('0');
  if (expectedRelease === 'B') await page.getByLabel('Client label').fill('domain-error');
  await Promise.all([
    page.locator('#status').filter({ hasText: /^Calculating…$/ }).waitFor({ state: 'visible' }),
    page.getByRole('button', { name: 'Calculate', exact: true }).click(),
  ]);
  const rejectedRow = page.locator('#records tr').filter({ hasText: rejectedId });
  await rejectedRow.waitFor({ state: 'visible' });
  assert.match(await rejectedRow.textContent(), /DivisionByZero/);

  if (faultTarget) {
    const database = stopDatabase();
    try {
      await Promise.all([
        page.locator('#status').filter({ hasText: /^Loading history…$/ }).waitFor({ state: 'visible' }),
        page.locator('#refresh').click(),
      ]);
      assert.equal(await page.locator('#records tr').count(), 0,
        'refresh retained stale rows while history I/O was pending');
      await page.locator('#status').filter({ hasText: /^History failed: / }).waitFor({ state: 'visible' });
      assert.equal(await page.locator('#records tr').count(), 0,
        'failed history refresh restored stale rows');
      assert.equal(await page.locator('#retry').isVisible(), true);
    } finally {
      await startDatabase(database);
    }
    await Promise.all([
      page.locator('#status').filter({ hasText: /^Loading history…$/ }).waitFor({ state: 'visible' }),
      page.locator('#retry').click(),
    ]);
    await page.locator('#records tr').filter({ hasText: requestId }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#retry').isHidden(), true,
      'successful history recovery retained a stale retry action');
  }

  await page.locator('#subject').fill('view-denied');
  assert.equal(await page.locator('#records tr').count(), 0,
    'an identity change retained the prior principal history');
  assert.equal(await page.locator('#history').isHidden(), true,
    'an identity change retained the authenticated history surface');
  assert.equal(await commandSection.isHidden(), true,
    'an identity change retained authenticated command controls');
  assert.equal(await page.locator('#retry').isHidden(), true,
    'an identity change retained a recovery action');
  await page.locator('#role').selectOption({ label: 'No application access' });
  await Promise.all([
    page.locator('#status').filter({ hasText: /^Authenticating…$/ }).waitFor({ state: 'visible' }),
    page.locator('#login button').click(),
  ]);
  await page.locator('#history').waitFor({ state: 'visible' });
  assert.equal(await commandSection.isHidden(), true);
  assert.equal(await page.locator('#status').textContent(), 'Access denied.');
  assert.equal(await page.locator('#records tr').count(), 0,
    'the denied principal retained history from the previous identity');
  assert.equal(await page.locator('#retry').isVisible(), true);
  await Promise.all([
    page.locator('#status').filter({ hasText: /^Loading history…$/ }).waitFor({ state: 'visible' }),
    page.locator('#retry').click(),
  ]);
  await page.locator('#status').filter({ hasText: /^Access denied\.$/ }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#retry').isVisible(), true);

  await page.locator('#subject').fill('view-auditor');
  await page.locator('#role').selectOption('calculator.auditor');
  await Promise.all([
    page.locator('#status').filter({ hasText: /^Authenticating…$/ }).waitFor({ state: 'visible' }),
    page.locator('#login button').click(),
  ]);
  await page.locator('#records tr').filter({ hasText: requestId }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#retry').isHidden(), true,
    'a successful new authentication retained a stale recovery action');
  assert.equal((await new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21aa',
    'wcag22aa'
  ]).analyze()).violations.length, 0);
  process.stdout.write(`${JSON.stringify({
    access_denied: 'real-empty-role-principal',
    fault_target: faultTarget || null,
    release: expectedRelease,
    schema: 'calculator/production-view-acceptance/1',
    status: 'passed',
    url: baseUrl
  })}\n`);
} finally {
  await browser.close();
}
