import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const decoder = new TextDecoder('utf-8', { fatal: true });
const model = JSON.parse(await readFile('artifacts/model.prism.json', 'utf8'));
const provenance = JSON.parse(await readFile('public/provenance.json', 'utf8'));
const viewManifest = JSON.parse(await readFile('artifacts/view-manifest.json', 'utf8'));
const application = model.application;

function decode(bytes) {
  return decoder.decode(Uint8Array.from(bytes));
}

function canonicalI64(value) {
  if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= -9223372036854775808n && parsed <= 9223372036854775807n;
}

function expectedText(response) {
  const fields = response.split('\t');
  if (fields.length !== 3 || fields[0] !== '1') throw new Error('invalid modeled response');
  if (fields[1] === 'ok') return fields[2];
  const messages = {
    'division-by-zero': application.view.division_error,
    overflow: application.view.overflow_error
  };
  if (fields[1] === 'error' && messages[fields[2]]) return messages[fields[2]];
  throw new Error('modeled response has no View projection');
}

const operations = new Map(
  application.view.operations.map((operation) => [operation.request_name, operation])
);
const browserVectors = application.acceptance_vectors.flatMap((vector) => {
  let request;
  let response;
  try {
    request = decode(vector.request);
    response = decode(vector.response);
  } catch {
    return [];
  }
  const fields = request.split('\t');
  if (
    fields.length !== 4 ||
    fields[0] !== '1' ||
    !operations.has(fields[1]) ||
    !canonicalI64(fields[2]) ||
    !canonicalI64(fields[3])
  ) {
    return [];
  }
  return [{ operation: operations.get(fields[1]), left: fields[2], right: fields[3], response }];
});

test('generated document, provenance, and accessibility are exact', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(application.view.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(application.view.heading);
  await expect(page.getByLabel(application.view.left_label)).toBeVisible();
  await expect(page.getByLabel(application.view.right_label)).toBeVisible();
  await expect(page.getByLabel(application.view.operation_label)).toBeVisible();
  await expect(page.getByRole('button', { name: application.view.submit_label })).toBeVisible();

  const options = page.locator('#operation option');
  await expect(options).toHaveCount(application.view.operations.length);
  for (let index = 0; index < application.view.operations.length; index += 1) {
    const expected = application.view.operations[index];
    await expect(options.nth(index)).toHaveText(expected.label);
    await expect(options.nth(index)).toHaveAttribute('value', String(expected.discriminant));
    await expect(options.nth(index)).toHaveAttribute('data-request', expected.request_name);
  }

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  expect(provenance.schema).toBe('prismpm/browser-provenance/1');
  expect(provenance.model_id).toBe(viewManifest.model_id);
  expect(provenance.view_model_id).toBe(viewManifest.view_model_id);
  expect(provenance.generated_core_sha256).toBe(viewManifest.generated_core_sha256);

  const closure = (await readdir('public')).sort();
  expect(closure).toEqual([
    'app.css',
    'app.js',
    'index.html',
    'prism_calculator.js',
    'prism_calculator_bg.wasm',
    'provenance.json'
  ]);
  const browserWasm = await readFile('public/prism_calculator_bg.wasm');
  expect(createHash('sha256').update(browserWasm).digest('hex')).toBe(
    provenance.adapter_wasm_sha256
  );
});

test('every modeled browser vector produces the transport-normalized Hologram state', async ({
  page
}) => {
  expect(new Set(browserVectors.map((vector) => vector.operation.request_name))).toEqual(
    new Set(application.view.operations.map((operation) => operation.request_name))
  );
  await page.goto('./');
  const observedTrace = [];
  const modeledTrace = [];

  for (const vector of browserVectors) {
    await page.getByLabel(application.view.left_label).fill(vector.left);
    await page.getByLabel(application.view.operation_label).selectOption(
      String(vector.operation.discriminant)
    );
    await page.getByLabel(application.view.right_label).fill(vector.right);
    await page.getByRole('button', { name: application.view.submit_label }).click();
    const expected = expectedText(vector.response);
    await expect(page.getByRole('status')).toHaveText(expected);
    const action = {
      action: 'ViewAction.Submit',
      operation: vector.operation.request_name,
      left: vector.left,
      right: vector.right,
      state: expected
    };
    modeledTrace.push(action);
    observedTrace.push({ ...action, state: await page.getByRole('status').textContent() });
  }
  expect(observedTrace).toEqual(modeledTrace);
});

test('the complete canonical signed-i64 grammar is enforced by the generated View', async ({
  page
}) => {
  expect(application.input_grammar).toBe('InputGrammar.AsciiSignedI64');
  const invalid = [
    '',
    ' ',
    '\t1',
    '1 ',
    '+1',
    '00',
    '01',
    '-0',
    '--1',
    '1.0',
    'one',
    '9223372036854775808',
    '-9223372036854775809'
  ];
  await page.goto('./');
  for (const value of invalid) {
    await page.getByLabel(application.view.left_label).fill(value);
    await page.getByLabel(application.view.right_label).fill('0');
    await page.getByRole('button', { name: application.view.submit_label }).click();
    await expect(page.getByRole('status')).toHaveText(application.view.input_error);
  }
});

test('Enter submits and focus stays on the modeled control', async ({ page }) => {
  expect(application.actions).toContain('ViewAction.Enter');
  expect(application.view.submit_on_enter).toBe(true);
  expect(application.view.retain_focus).toBe(true);
  const vector = browserVectors.find((candidate) => candidate.response.includes('\tok\t'));
  expect(vector).toBeTruthy();

  await page.goto('./');
  const left = page.getByLabel(application.view.left_label);
  await left.fill(vector.left);
  await page.getByLabel(application.view.operation_label).selectOption(
    String(vector.operation.discriminant)
  );
  await page.getByLabel(application.view.right_label).fill(vector.right);
  await left.focus();
  await left.press('Enter');
  await expect(page.getByRole('status')).toHaveText(expectedText(vector.response));
  await expect(left).toBeFocused();
});
