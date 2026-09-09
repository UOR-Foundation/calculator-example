#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validateTargetPolicies } from './target-policy.mjs';

const sourcePath = 'src/CalculatorSystem.lex.tex';
const source = await readFile(sourcePath, 'utf8');
const applicationSource = await readFile('src/Calculator.lex.tex');
const marker = '\\semanticdata{';
const start = source.indexOf(marker);
const end = source.indexOf('\n\\end{semanticmodule}', start);
if (start < 0 || end < 0) throw new Error('CalculatorSystem semantic module is malformed');
const framed = source.slice(start + marker.length, end);
const semantic = JSON.parse(framed.slice(0, -1));

function decode(node) {
  if (!node || typeof node !== 'object') throw new Error('invalid semantic value');
  switch (node.kind) {
    case 'bool':
    case 'string': return node.value;
    case 'integer':
    case 'nat': return Number(node.value);
    case 'record': return Object.fromEntries(node.fields.map((row) => [row.field, decode(row.value)]));
    case 'nil': return [];
    case 'cons': return [decode(node.head), ...decode(node.tail)];
    case 'constructor': {
      if (node.constructor?.name === 'Option.none') return null;
      if (node.constructor?.name === 'Option.some' && node.arguments?.length === 1) {
        return decode(node.arguments[0]);
      }
      throw new Error(`unsupported semantic constructor ${node.constructor?.name}`);
    }
    default: throw new Error(`unsupported semantic value kind ${node.kind}`);
  }
}

const release = (name) => {
  const declaration = semantic.declarations.find((row) => row.kind === 'definition' && row.name === name);
  if (!declaration) throw new Error(`${name} is absent`);
  return decode(declaration.body);
};
const releases = [release('systemModelA'), release('systemModelB')];
const sourceDigest = createHash('sha256').update(source).digest('hex');
const rows = (values, render) => values.map(render).join('\n');
const byteCompare = (left, right) => Buffer.from(left).compare(Buffer.from(right));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const exactIds = (values, expected, description) => {
  const ids = values.map((row) => row.id);
  assert(new Set(ids).size === ids.length, `${description} IDs are not unique`);
  assert(JSON.stringify([...ids].sort(byteCompare)) === JSON.stringify([...expected].sort(byteCompare)),
    `${description} closure changed`);
};
const a = releases[0];
const b = releases[1];
assert(createHash('sha256').update(applicationSource).digest('hex') ===
  'd58c4f73e88228f0580e75d464cbf11f8d32ef9ef709271fa4fb2a074ef680fc',
'the authoritative Calculator application source changed');
if (a.product.id !== b.product.id || a.product.version !== 'A' || b.product.version !== 'B') {
  throw new Error('CalculatorSystem does not define the required A/B product pair');
}
const targetIds = b.targets.map((row) => row.id).sort();
if (JSON.stringify(targetIds) !== JSON.stringify(['compose-local', 'github-pages', 'kubernetes-kind'])) {
  throw new Error('CalculatorSystem target closure changed');
}
for (const model of releases) validateTargetPolicies(model.targets, 'minimumReleaseStatus');

for (const model of releases) {
  assert(model.applicationProfile.applicationModelDigest ===
    'sha256:3c7870c06fb36b1e3849a426a0309558efe73c32aa7c686bc018c4d7edaf0705',
  `release ${model.product.version} is not bound to the unchanged Calculator application model`);
  const modelCollections = [
    'acceptance', 'alerts', 'architecture', 'artifacts', 'backups', 'calls', 'capabilities',
    'components', 'controls', 'drifts', 'events', 'flows', 'identityRequirements', 'interfaces',
    'migrations', 'parameters', 'platformRequirements', 'persistence', 'retirements', 'rollbacks',
    'rollouts', 'scalingPolicies', 'schemas', 'slis', 'slos', 'targets', 'topology', 'storageClasses',
  ];
  const allIds = modelCollections.flatMap((name) => {
    const ids = model[name].map((row) => row.id);
    assert(JSON.stringify(ids) === JSON.stringify([...ids].sort(byteCompare)),
      `release ${model.product.version} ${name} IDs are not byte-sorted`);
    return ids;
  });
  assert(new Set(allIds).size === allIds.length,
    `release ${model.product.version} IDs are not globally unique`);
  exactIds(model.components,
    ['api', 'audit-worker', 'broker', 'browser', 'database', 'issuer', 'migrate', 'telemetry'],
    `release ${model.product.version} component`);
  exactIds(model.interfaces,
    ['calculation-events', 'calculator-http', 'database-sql', 'identity-oidc', 'telemetry-otlp'],
    `release ${model.product.version} interface`);
  exactIds(model.events, ['calculation-rejected', 'calculation-succeeded'],
    `release ${model.product.version} event`);
  exactIds(model.platformRequirements, ['linux-oci', 'web-holo'],
    `release ${model.product.version} platform requirement`);
  exactIds(model.scalingPolicies, ['api-scaling', 'audit-worker-scaling', 'browser-scaling'],
    `release ${model.product.version} scaling policy`);
  exactIds(model.storageClasses, ['kind-static-local'],
    `release ${model.product.version} storage class`);
  exactIds(model.secretReferences,
    ['broker-credentials', 'database-credentials', 'oidc-signing-key', 'postgres-password',
      'rabbitmq-default-pass', 'tls-certificate'],
    `release ${model.product.version} secret reference`);
  assert(JSON.stringify(model.product.supportedPlatforms) === JSON.stringify(['linux-oci', 'web-holo']),
    `release ${model.product.version} product platform support changed`);

  const componentIds = new Set(model.components.map((row) => row.id));
  const interfaceIds = new Set(model.interfaces.map((row) => row.id));
  const schemaIds = new Set(model.schemas.map((row) => row.id));
  const acceptanceIds = new Set(model.acceptance.map((row) => row.id));
  const artifactIds = new Set(model.artifacts.map((row) => row.id));
  for (const component of model.components) {
    assert(component.isolation && component.failurePolicy && component.retryPolicy &&
      component.degradationPolicy && component.idempotency,
    `component ${component.id} has an open execution/failure policy`);
    assert(component.platformRequirements.includes('linux-oci'),
      `component ${component.id} lacks its Linux OCI platform requirement`);
    assert(component.interfaces.every((value) => interfaceIds.has(value)),
      `component ${component.id} references an unknown interface`);
    assert(component.scalingPolicy === null || model.scalingPolicies.some((row) => row.id === component.scalingPolicy),
      `component ${component.id} references an unknown scaling policy`);
  }
  for (const iface of model.interfaces) {
    assert(schemaIds.has(iface.document), `interface ${iface.id} document is unresolved`);
    assert(iface.protocol && iface.compatibility && iface.errors.length > 0,
      `interface ${iface.id} protocol/error/compatibility policy is incomplete`);
    assert(iface.acceptance.length > 0 && iface.acceptance.every((value) => acceptanceIds.has(value)),
      `interface ${iface.id} acceptance evidence is unresolved`);
  }
  for (const call of model.calls) {
    assert(componentIds.has(call.fromComponent) && componentIds.has(call.toComponent) &&
      interfaceIds.has(call.interfaceId), `call ${call.id} endpoint is unresolved`);
    assert(call.failurePropagation && call.retryPolicy && call.idempotency && call.timeoutMillis > 0,
      `call ${call.id} failure/idempotency contract is incomplete`);
  }
  for (const event of model.events) {
    assert(componentIds.has(event.producer) && interfaceIds.has(event.channel) && schemaIds.has(event.schemaId),
      `event ${event.id} binding is unresolved`);
    assert(event.delivery === 'at-least-once' && event.idempotency === 'event-id' &&
      event.failurePropagation === 'transactional-outbox',
      `event ${event.id} makes an unsupported delivery/idempotency claim`);
  }
  for (const flow of model.flows) {
    assert(componentIds.has(flow.fromComponent) && componentIds.has(flow.toComponent) &&
      interfaceIds.has(flow.interfaceId) && flow.idempotency && flow.failurePropagation,
    `flow ${flow.id} is not closed`);
  }
  for (const binding of model.architecture) {
    assert(binding.owner && binding.viewpoint && binding.verifies.length > 0 &&
      binding.verifies.every((value) => acceptanceIds.has(value)),
    `architecture binding ${binding.id} lacks owned executable evidence`);
  }
  for (const control of model.controls) {
    assert(control.owner && control.verification.length > 0 &&
      control.verification.every((value) => acceptanceIds.has(value)),
    `control ${control.id} lacks owned executable verification`);
  }
  const kind = model.targets.find((row) => row.id === 'kubernetes-kind');
  assert(kind.storageClass === 'kind-static-local' &&
    kind.storageProfile === 'kind-static-local' &&
    kind.ingressClassName === 'nginx' &&
    kind.ingressControllerArtifact === 'kind-ingress-controller' &&
    artifactIds.has(kind.ingressControllerArtifact),
  `release ${model.product.version} Kind storage/ingress binding is incomplete`);
  const issuer = model.components.find((row) => row.id === 'issuer');
  assert(JSON.stringify(issuer.secrets) === JSON.stringify(['oidc-signing-key']) &&
    model.secretReferences.find((row) => row.id === 'oidc-signing-key')?.providerKey ===
      'calculator/oidc-signing-key',
  `release ${model.product.version} OIDC signing key is not a modeled late-bound reference`);
  assert(model.applicationProfile.view.deniedRoleLabel === 'No application access',
    `release ${model.product.version} View lacks its modeled denied-principal state`);
  assert(kind.adapterDigest === 'sha256:12021a034cb9b796f1ab6b4431e5cdbd9803e16181f6378ce580e40764b62ff6',
    `release ${model.product.version} does not use the canonical Kubernetes adapter`);
  const compose = model.targets.find((row) => row.id === 'compose-local');
  assert(compose.adapterDigest === 'sha256:0a74dacc5da9c48e582155a2dcc5e830cf71dd054e62c9e6eeb3ccec1e20c255',
    `release ${model.product.version} does not use the canonical Compose adapter`);
  const controller = model.artifacts.find((row) => row.id === 'kind-ingress-controller');
  const admission = model.artifacts.find((row) => row.id === 'kind-ingress-admission');
  assert(controller?.path === 'registry.k8s.io/ingress-nginx/controller' &&
    controller.digest === 'sha256:594ceea76b01c592858f803f9ff4d2cb40542cae2060410b2c95f75907d659e1' &&
    admission?.path === 'registry.k8s.io/ingress-nginx/kube-webhook-certgen' &&
    admission.digest === 'sha256:01038e7de14b78d702d2849c3aad72fd25903c4765af63cf16aa3398f5d5f2dd',
  `release ${model.product.version} ingress runtime closure differs from the pinned adapter`);
  assert(model.storageClasses[0].retention === 'retain',
    `release ${model.product.version} static storage is not retained`);
  for (const topology of model.topology) {
    assert(topology.isolation && topology.capabilities.length > 0 && topology.scaleMin > 0 &&
      topology.scaleMax >= topology.scaleMin && topology.platformRequirements.includes('linux-oci'),
    `topology ${topology.id} has an open isolation/scale/platform policy`);
    if (topology.kind === 'persistent-volume') {
      assert(topology.storageClass === 'kind-static-local' && topology.placement === 'kind-control-plane',
        `persistent topology ${topology.id} lacks static Kind placement`);
    }
  }
}

const document = `# Calculator conformance

Generated from [\`${sourcePath}\`](${sourcePath}) at
\`sha256:${sourceDigest}\`. Do not edit this file directly; run
\`just model-write\` after changing the authoritative model.

The unchanged \`Calculator.lex.tex\` application remains the authority for
checked arithmetic, Holo/1, Core-Wasm, Cargo, View, and portable Pages.
\`CalculatorSystem.lex.tex\` is the sole authority for the production system.

## Modeled releases

| Release | Components | Interfaces | Events | Persistence | Migrations | Targets | Acceptance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows(releases, (value) => `| ${value.product.version} | ${value.components.length} | ${value.interfaces.length} | ${value.events.length} | ${value.persistence.length} | ${value.migrations.length} | ${value.targets.length} | ${value.acceptance.length} |`)}

## Generated targets

| ID | Kind | API version | Minimum release | Required capabilities |
| --- | --- | --- | --- | --- |
${rows([...b.targets].sort((left, right) => byteCompare(left.id, right.id)), (value) => `| \`${value.id}\` | ${value.kind} | \`${value.apiVersion}\` | \`${value.minimumReleaseStatus}\` | ${value.capabilities.map((item) => `\`${item}\``).join(', ')} |`)}

## Modeled acceptance

| ID | Kind | Target | Generated command | Evidence |
| --- | --- | --- | --- | --- |
${rows([...b.acceptance].sort((left, right) => byteCompare(left.id, right.id)), (value) => `| \`${value.id}\` | ${value.kind} | \`${value.target}\` | \`${value.command.join(' ')}\` | \`${value.evidence}\` |`)}

## Repository gates

| Gate | Executed evidence |
| --- | --- |
| \`just vv\` | locked generation and proofs, exact projections, Cargo consumer, Pages browser, two-root reproduction, Compose, Kind, and complete conformance; no reduced or skip path |
| \`just accept-compose\` | real API/View, PostgreSQL/outbox/audit, telemetry redaction and measured SLO evidence, foreground signal supervision with reverse-dependency shutdown, fault injection, late-bound OIDC signing-key rotation, migration, restore, rollback, contract floor, and SDK-authorized source/restored-target retirement |
| \`just accept-kind\` | Kubernetes ${b.targets.find((row) => row.id === 'kubernetes-kind').apiVersion} A/B deployment through real TLS ingress and retained static storage, API/View, measured SLO and telemetry evidence, dependency/network/resource recovery, failed rollout, mixed-version window, TLS and late-bound OIDC signing-key rotation, drift, rollback, contract floor, logical backup plus restore into a newly created clean cluster, and SDK-authorized source/restored-target retirement |
| \`just accept-pages\` | generated browser trace, accessibility, live HTTPS behavior, and exact six-file served closure; ordinary protected-ref publication is byte-bound to independently verified accepted CalculatorSystem release B |
| \`just accept-conformance\` | SDK runner executes all 147 public feature cases and 83 planted diagnostic cases against each exact A/B release |
| \`just test-formal-model-mutations\` | one clean positive LexLean/Lean proof plus twelve isolated authoritative-model mutations, each rejected by its corresponding named validator theorem while its manifest remains fixed |
| \`just test-baseline-evidence\` | canonical historical/sealing, coverage/authority, target-release, runtime binding/index, immutable-workflow, complete acceptance dispatch, SDK executable, and installed model-input contracts plus their planted adversarial defects |
| \`just accept-production\` | exact external image indexes and amd64/arm64 pulls, Pages bound byte-for-byte to accepted release B, Compose, Kind, conformance attachment, and immutable GHCR push/pull/inspect plus independent signature-closure verification |

No passing row is inferred from file existence. Gates fail when infrastructure,
identity, an oracle, evidence, or a required tool is unavailable; external
unavailability is never converted to a skip.

The repository workflow executes \`just vv\` twice consecutively from one
checkout so stale evidence and cleanup assumptions cannot pass only on a fresh
first run.
`;

await writeFile('CONFORMANCE.md', document);
