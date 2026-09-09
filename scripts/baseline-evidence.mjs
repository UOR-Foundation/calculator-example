import { createHash } from 'node:crypto';

export const evidenceSchema = 'calculator/baseline-verification-evidence/1';

export const expectedRuns = Object.freeze([
  Object.freeze({command: Object.freeze(['just', 'vv']), filename: 'prismpm-1.json', repeat: 1, repository: 'https://github.com/UOR-Foundation/PrismPM'}),
  Object.freeze({command: Object.freeze(['just', 'vv']), filename: 'prismpm-2.json', repeat: 2, repository: 'https://github.com/UOR-Foundation/PrismPM'}),
  Object.freeze({command: Object.freeze(['just', 'baseline-input']), filename: 'calculator-example-1.json', repeat: 1, repository: 'https://github.com/UOR-Foundation/calculator-example'}),
  Object.freeze({command: Object.freeze(['just', 'vv']), filename: 'lexlean-1.json', repeat: 1, repository: 'https://github.com/afflom/LexLean'}),
  Object.freeze({command: Object.freeze(['just', 'ci']), filename: 'lean4-prod-1.json', repeat: 1, repository: 'https://github.com/afflom/lean4-prod'}),
]);

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const order = (left, right) => Buffer.from(left).compare(Buffer.from(right));
  if (JSON.stringify(Object.keys(value).sort(order)) !== JSON.stringify([...keys].sort(order))) {
    throw new Error(`${label} has missing or extra fields`);
  }
}

function validateTranscript(value, label) {
  exactKeys(value, ['base64', 'sha256', 'size'], label);
  if (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > 64 * 1024 * 1024) {
    throw new Error(`${label}.size is outside the 64 MiB evidence bound`);
  }
  if (typeof value.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) {
    throw new Error(`${label}.base64 is not canonical base64`);
  }
  const bytes = Buffer.from(value.base64, 'base64');
  if (bytes.toString('base64') !== value.base64 || bytes.length !== value.size) throw new Error(`${label} encoded bytes or size do not agree`);
  if (digest(bytes) !== value.sha256) throw new Error(`${label} digest does not agree`);
}

export function validateEvidence(raw, expected, sdkImage) {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 96 * 1024 * 1024) throw new Error(`${expected.filename} is empty or exceeds the evidence bound`);
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${expected.filename} is not JSON`); }
  if (raw.toString('utf8') !== canonical(value)) throw new Error(`${expected.filename} is not canonical JSON without framing whitespace`);
  exactKeys(value, ['command', 'commit', 'environment', 'exit_code', 'repeat', 'repository', 'schema', 'status', 'stderr', 'stdout', 'worktree'], expected.filename);
  if (value.schema !== evidenceSchema || value.status !== 'passed' || value.exit_code !== 0) throw new Error(`${expected.filename} is not a passing baseline verification`);
  if (value.repository !== expected.repository || value.repeat !== expected.repeat || JSON.stringify(value.command) !== JSON.stringify(expected.command)) {
    throw new Error(`${expected.filename} does not match its repository, command, and repeat binding`);
  }
  if (typeof value.commit !== 'string' || !/^[0-9a-f]{40}$/.test(value.commit)) throw new Error(`${expected.filename} does not bind a full Git object ID`);
  exactKeys(value.environment, ['image', 'kind'], `${expected.filename}.environment`);
  if (value.environment.kind !== 'devcontainer' || !/^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$/.test(value.environment.image)) {
    throw new Error(`${expected.filename} does not bind an immutable devcontainer image`);
  }
  if (value.environment.image !== sdkImage) throw new Error(`${expected.filename} was produced by a stale or different SDK image`);
  exactKeys(value.worktree, ['clean_after', 'clean_before'], `${expected.filename}.worktree`);
  if (value.worktree.clean_before !== true || value.worktree.clean_after !== true) throw new Error(`${expected.filename} was not captured from a clean source closure`);
  validateTranscript(value.stdout, `${expected.filename}.stdout`);
  validateTranscript(value.stderr, `${expected.filename}.stderr`);
  return value;
}

export function validateEvidenceSet(entries, sdkImage, calculatorCommit) {
  const order = (left, right) => Buffer.from(left).compare(Buffer.from(right));
  const actualNames = [...entries.keys()].sort(order);
  const expectedNames = expectedRuns.map(({filename}) => filename).sort(order);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error('baseline evidence directory has missing or extra files');
  const values = expectedRuns.map((expected) => validateEvidence(entries.get(expected.filename), expected, sdkImage));
  const calculator = values.find(({repository}) => repository === 'https://github.com/UOR-Foundation/calculator-example');
  if (!calculator || calculator.commit !== calculatorCommit) throw new Error('Calculator evidence does not bind the exact current input commit');
  const subjects = values.map(({repository, repeat}) => `${repository}\0${repeat}`);
  if (new Set(subjects).size !== values.length) throw new Error('baseline evidence subjects are duplicated');
  const commitsByRepository = new Map();
  for (const value of values) {
    const prior = commitsByRepository.get(value.repository);
    if (prior !== undefined && prior !== value.commit) {
      throw new Error(`repeated baseline runs use different commits for ${value.repository}`);
    }
    commitsByRepository.set(value.repository, value.commit);
  }
  return values;
}
