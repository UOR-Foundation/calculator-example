#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository = mkdtempSync(path.join(os.tmpdir(), 'calculator-render-transaction.'));
const outputPaths = [
  '.devcontainer/devcontainer.json',
  '.github/workflows/bootstrap.yml',
  '.github/workflows/pages.yml',
  '.github/workflows/platform-equivalence.yml',
  '.github/workflows/prismpm.yml',
  '.github/workflows/production.yml',
  '.github/workflows/publish-crate.yml',
  '.github/workflows/template-update.yml',
  '.github/workflows/verify.yml',
  'prismpm.lock',
  'standards.lock',
  'template-contract.json',
  'template.lock',
  'src/CalculatorSystem.lex.tex',
  'lexlean.lock',
];
const requiredInputs = [
  ...outputPaths.filter((name) =>
    !['prismpm.lock', 'standards.lock', 'template.lock'].includes(name)),
  'AGENTS.md',
  'CONFORMANCE.md',
  'TEMPLATE-CONTRACT.md',
  'VERIFICATION.md',
  'bootstrap/render.mjs',
  'bootstrap/render.sh',
  'scripts/runtime-binding.mjs',
  'scripts/update-runtime-binding.mjs',
  'template-contract.json',
];

try {
  for (const name of requiredInputs) {
    const target = path.join(repository, name);
    mkdirSync(path.dirname(target), {recursive: true});
    if (name === 'bootstrap/render.sh') {
      cpSync(new URL('../bootstrap/render.sh', import.meta.url), target);
      chmodSync(target, 0o755);
    } else {
      writeFileSync(target, `original:${name}\n`);
    }
  }
  const originals = new Map(outputPaths
    .filter((name) => existsSync(path.join(repository, name)))
    .map((name) => [name, readFileSync(path.join(repository, name))]));
  execFileSync('git', ['init', '-q'], {cwd: repository});
  execFileSync('git', ['config', 'user.email', 'calculator-render@example.invalid'], {cwd: repository});
  execFileSync('git', ['config', 'user.name', 'Calculator render test'], {cwd: repository});
  execFileSync('git', ['add', '.'], {cwd: repository});
  execFileSync('git', ['commit', '-qm', 'test input'], {cwd: repository});

  const bin = path.join(repository, 'fake-bin');
  mkdirSync(bin);
  const docker = path.join(bin, 'docker');
  writeFileSync(docker, `#!/bin/sh
set -eu
count_file="$PWD/.docker-call-count"
count=0
test ! -f "$count_file" || count=$(cat "$count_file")
count=$((count + 1))
printf '%s\n' "$count" >"$count_file"
if test "$count" -eq 1; then
  for file in ${outputPaths.map((name) => `'${name}'`).join(' ')}; do
    mkdir -p "$(dirname "$file")"
    printf 'mutated:%s\n' "$file" >"$file"
  done
  exit 0
fi
test "\${FAKE_RENDER_SUCCESS:-}" != 1 || exit 0
test "\${FAKE_RENDER_SIGNAL:-}" != 1 || kill -TERM $$
exit 73
`);
  chmodSync(docker, 0o755);
  const result = spawnSync(path.join(repository, 'bootstrap/render.sh'), [
    `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`,
    `UOR-Foundation/PrismPM/action@${'b'.repeat(40)}`,
    'c'.repeat(40),
    `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'d'.repeat(64)}`,
  ], {
    cwd: repository,
    encoding: 'utf8',
    env: {...process.env, PATH: `${bin}:${process.env.PATH}`},
  });
  assert.equal(result.status, 73, `planted second render phase returned ${result.status}: ${result.stderr}`);
  for (const [name, bytes] of originals) {
    assert(readFileSync(path.join(repository, name)).equals(bytes), `${name} was not restored`);
  }
  assert.equal(existsSync(path.join(repository, 'standards.lock')), false,
    'newly created standards.lock survived a failed render');
  assert.equal(existsSync(path.join(repository, 'prismpm.lock')), false,
    'newly created prismpm.lock survived a failed initial render');
  assert.equal(existsSync(path.join(repository, 'template.lock')), false,
    'newly created template.lock survived a failed initial render');
  rmSync(path.join(repository, '.docker-call-count'));
  const interrupted = spawnSync(path.join(repository, 'bootstrap/render.sh'), [
    `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`,
    `UOR-Foundation/PrismPM/action@${'b'.repeat(40)}`,
    'c'.repeat(40),
    `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'d'.repeat(64)}`,
  ], {
    cwd: repository,
    encoding: 'utf8',
    env: {...process.env, FAKE_RENDER_SIGNAL: '1', PATH: `${bin}:${process.env.PATH}`},
  });
  assert.equal(interrupted.status, 143,
    `interrupted planted render returned ${interrupted.status}: ${interrupted.stderr}`);
  for (const [name, bytes] of originals) {
    assert(readFileSync(path.join(repository, name)).equals(bytes),
      `${name} was not restored after interruption`);
  }
  assert.equal(existsSync(path.join(repository, 'standards.lock')), false,
    'newly created standards.lock survived an interrupted render');
  assert.equal(existsSync(path.join(repository, 'prismpm.lock')), false,
    'newly created prismpm.lock survived an interrupted initial render');
  assert.equal(existsSync(path.join(repository, 'template.lock')), false,
    'newly created template.lock survived an interrupted initial render');
  rmSync(path.join(repository, '.docker-call-count'));
  const success = spawnSync(path.join(repository, 'bootstrap/render.sh'), [
    `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`,
    `UOR-Foundation/PrismPM/action@${'b'.repeat(40)}`,
    'c'.repeat(40),
    `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'d'.repeat(64)}`,
  ], {
    cwd: repository,
    encoding: 'utf8',
    env: {...process.env, FAKE_RENDER_SUCCESS: '1', PATH: `${bin}:${process.env.PATH}`},
  });
  assert.equal(success.status, 0, `complete planted render failed: ${success.stderr}`);
  for (const name of outputPaths) {
    assert.equal(readFileSync(path.join(repository, name), 'utf8'), `mutated:${name}\n`,
      `${name} was not retained by a successful render`);
  }

  execFileSync('git', ['add', '.'], {cwd: repository});
  execFileSync('git', ['commit', '-qm', 'lock initial migration'], {cwd: repository});
  const agents = path.join(repository, 'AGENTS.md');
  const agentsBytes = readFileSync(agents);
  writeFileSync(agents, Buffer.concat([agentsBytes, Buffer.from('dirty\n')]));
  const dirty = spawnSync(path.join(repository, 'bootstrap/render.sh'), [
    `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`,
    `UOR-Foundation/PrismPM/action@${'b'.repeat(40)}`,
    'c'.repeat(40),
    `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'d'.repeat(64)}`,
  ], {cwd: repository, encoding: 'utf8', env: {...process.env, PATH: `${bin}:${process.env.PATH}`}});
  assert.equal(dirty.status, 64, 'a dirty post-migration policy input was accepted');
  assert.match(dirty.stderr, /uncommitted universal policy changes/);
  writeFileSync(agents, agentsBytes);

  const oneLock = mkdtempSync(path.join(os.tmpdir(), 'calculator-render-one-lock.'));
  try {
    mkdirSync(path.join(oneLock, 'bootstrap'), {recursive: true});
    cpSync(new URL('../bootstrap/render.sh', import.meta.url),
      path.join(oneLock, 'bootstrap', 'render.sh'));
    chmodSync(path.join(oneLock, 'bootstrap', 'render.sh'), 0o755);
    writeFileSync(path.join(oneLock, 'prismpm.lock'), '{}\n');
    execFileSync('git', ['init', '-q'], {cwd: oneLock});
    execFileSync('git', ['config', 'user.email', 'calculator-render@example.invalid'], {cwd: oneLock});
    execFileSync('git', ['config', 'user.name', 'Calculator render test'], {cwd: oneLock});
    execFileSync('git', ['add', '.'], {cwd: oneLock});
    execFileSync('git', ['commit', '-qm', 'plant one lock'], {cwd: oneLock});
    const mismatched = spawnSync(path.join(oneLock, 'bootstrap', 'render.sh'), [
      `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`,
      `UOR-Foundation/PrismPM/action@${'b'.repeat(40)}`,
      'c'.repeat(40),
      `ghcr.io/uor-foundation/prismpm-runtime@sha256:${'d'.repeat(64)}`,
    ], {cwd: oneLock, encoding: 'utf8'});
    assert.equal(mismatched.status, 64, 'a one-lock policy state was accepted');
    assert.match(mismatched.stderr, /must become policy inputs together/);
  } finally {
    rmSync(oneLock, {recursive: true, force: true});
  }
} finally {
  rmSync(repository, {recursive: true, force: true});
}

process.stdout.write('bootstrap render atomic success/rollback adversarial test passed\n');
