#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {validateWorkflowPolicy} from './workflow-policy.mjs';

const directory = '.github/workflows';
const workflows = new Map(readdirSync(directory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  .map((name) => [name, readFileSync(`${directory}/${name}`, 'utf8')]));
validateWorkflowPolicy(workflows);

const reject = (name, file, replace, pattern) => {
  const planted = new Map(workflows);
  const source = planted.get(file);
  const changed = replace(source);
  assert.notEqual(changed, source, `${name} did not plant a defect`);
  planted.set(file, changed);
  assert.throws(() => validateWorkflowPolicy(planted), pattern, `${name} was accepted`);
};
reject('floating-runner', 'verify.yml', (source) =>
  source.replace('ubuntu-24.04', 'ubuntu-latest'), /floating runner/);
reject('floating-action', 'verify.yml', (source) =>
  source.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v4'),
  /non-immutable action/);
reject('shallow-history', 'verify.yml', (source) =>
  source.replace('          fetch-depth: 0\n', ''), /fetch exact history/);
reject('skipped-gate', 'verify.yml', (source) =>
  source.replace('    steps:', `    ${['continue-on-error:', 'true'].join(' ')}\n    steps:`), /failed gate/);
reject('host-docker-plugin', 'verify.yml', (source) =>
  source.replace('$docker_config:/tmp/prismpm-docker', '$HOME/.docker:/tmp/prismpm-docker'),
  /host Docker CLI plugins/);
reject('unverified-pull', 'production.yml', (source) =>
  source.replace('command: verify-release', 'command: inspect'), /immediately after pull/);
reject('hidden-store-omission', 'production.yml', (source) =>
  source.replace('          include-hidden-files: true\n', ''), /hidden release-store/);
reject('unmodeled-default-target', 'prismpm.yml', (source) =>
  source.replace('        default: kubernetes-kind\n', '        default: kubernetes-production\n'),
  /modeled Kubernetes target/);
reject('deploy-signing-identity', 'prismpm.yml', (source) =>
  source.replace(
    '  deploy:\n    name: deploy the planned digest without rebuilding',
    '  deploy:\n    permissions:\n      id-token: write\n    name: deploy the planned digest without rebuilding'),
  /signing identity/);
reject('accepted-conformance-bypass', 'prismpm.yml', (source) =>
  source.replace('          command: conformance\n', '          command: inspect\n'),
  /bypass production conformance/);
reject('pages-development-release', 'pages.yml', (source) =>
  source.replace('result.status !== "accepted"', 'result.status !== "development"'),
  /exact accepted release byte binding/);
reject('pages-wrong-system-release', 'pages.yml', (source) =>
  source.replace('system.product?.version !== "B"', 'system.product?.version !== "A"'),
  /exact accepted release byte binding/);
reject('pages-release-byte-bypass', 'pages.yml', (source) =>
  source.replace('cmp "$temporary/$name" "public/$name"', 'true # byte comparison removed'),
  /exact accepted release byte binding/);
reject('pages-publish-regeneration', 'pages.yml', (source) =>
  source.replace("        if: inputs.release-reference == ''\n        run: |\n", '        run: |\n'),
  /exact accepted release byte binding/);
reject('pages-bootstrap-on-push', 'pages.yml', (source) =>
  source.replace("github.event_name == 'workflow_dispatch'", "github.event_name == 'push'"),
  /exact accepted release byte binding/);
reject('pages-unprotected-release', 'pages.yml', (source) =>
  source.replace("(inputs.release-reference != '' && github.ref_protected)",
    "inputs.release-reference != ''"), /exact accepted release byte binding/);
reject('production-pages-unverified', 'production.yml', (source) =>
  source.replace('    needs: [build, verify-published]\n', '    needs: build\n'),
  /exact verified accepted release/);
reject('copied-renderer-overwrite', 'template-update.yml', (source) =>
  source.replace('for path in AGENTS.md', 'for path in bootstrap/render.sh AGENTS.md'),
  /project ownership/);
reject('project-gate-deletion', 'template-update.yml', (source) =>
  source.replace('rm -rf .template-policy', 'rm -f .github/workflows/honesty.yml'),
  /project ownership/);
reject('runtime-update-omitted', 'template-update.yml', (source) =>
  source.replace('"$TEMPLATE_REVISION" "$RUNTIME_IMAGE"', '"$TEMPLATE_REVISION"'),
  /complete runtime update/);
reject('dependent-lock-omitted', 'template-update.yml', (source) =>
  source.replace('src/CalculatorSystem.lex.tex lexlean.lock', 'src/CalculatorSystem.lex.tex'),
  /complete runtime update/);
reject('copied-only-pipeline', 'verify.yml', (source) =>
  source.replace(/    uses: UOR-Foundation\/PrismPM\/\.github\/workflows\/sdk\.yml@[^\n]+/,
    '    uses: ./.github/workflows/prismpm.yml'), /released read-only pipeline/);
process.stdout.write('workflow policy positive and adversarial tests passed\n');
