#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateTargetPolicies } from './target-policy.mjs';

const [root, expectedRelease] = process.argv.slice(2);
if (!root || !expectedRelease || !['A', 'B'].includes(expectedRelease)) {
  throw new Error('usage: verify-system-projections.mjs BUILD_ROOT A|B');
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const objects = (manifest) => manifest.kind === 'List' ? manifest.items : manifest;
const projection = (name) => join(root, 'projections', name);

const [system, runtime, openapi, asyncapi, cloudEvents, compose, kubernetes, collector] =
  await Promise.all([
    readJson(join(root, 'system.prism.json')),
    readJson(projection('runtime-contract.json')),
    readJson(projection('openapi.json')),
    readJson(projection('asyncapi.json')),
    readJson(projection('cloudevents.schema.json')),
    readJson(projection('compose.json')),
    readJson(projection('kubernetes.json')),
    readJson(projection('opentelemetry-collector.json')),
  ]);

assert(system.schema === 'prismpm/system-model/1', 'system semantic snapshot schema changed');
assert(system.product.version === expectedRelease, 'system snapshot release does not match the requested release');
assert(runtime.release === expectedRelease, 'runtime contract release does not match the system snapshot');
assert(runtime.application_model_digest === system.application_profile.application_model_digest,
  'runtime contract is not bound to the system application identity');

const has = (row, fields, kind) => {
  for (const field of fields) {
    assert(Object.hasOwn(row, field), `${kind}/${row.id ?? '<unnamed>'} omits typed ${field}`);
  }
};
const platformIds = new Set(system.platform_requirements.map((row) => row.id));
assert(platformIds.has('linux-oci') && platformIds.has('web-holo'),
  'system platform-requirement closure is incomplete');
assert(system.product.supported_platforms.every((id) => platformIds.has(id)),
  'product supported platforms are not modeled platform requirements');
const linuxOci = system.platform_requirements.find((row) => row.id === 'linux-oci');
assert(linuxOci?.os === 'linux' && linuxOci.runtime === 'oci' &&
  JSON.stringify(linuxOci.architectures) === JSON.stringify(['amd64', 'arm64']),
'the modeled OCI platform must support exactly linux/amd64 and linux/arm64');
for (const row of system.platform_requirements) {
  has(row, ['os', 'architectures', 'runtime', 'runtime_version', 'capabilities'],
    'platform-requirement');
  assert(row.architectures.length > 0, `platform-requirement/${row.id} has no architecture`);
}
for (const row of system.scaling_policies) {
  has(row, ['component', 'trigger', 'minimum', 'maximum', 'step', 'cooldown_seconds'],
    'scaling-policy');
  assert(row.minimum <= row.maximum, `scaling-policy/${row.id} has inverted bounds`);
}
for (const row of system.storage_classes) {
  has(row, ['access_modes', 'binding_mode', 'provisioning', 'retention', 'capabilities',
    'platform_requirements'], 'storage-class');
  assert(row.platform_requirements.every((id) => platformIds.has(id)),
    `storage-class/${row.id} has an unknown platform requirement`);
}
for (const row of system.artifacts) {
  has(row, ['platform_requirements'], 'artifact');
  assert(row.platform_requirements.every((id) => platformIds.has(id)),
    `artifact/${row.id} has an unknown platform requirement`);
}
for (const row of system.components) {
  has(row, ['isolation', 'placement', 'platform_requirements', 'scaling_policy',
    'failure_policy', 'retry_policy', 'degradation_policy', 'idempotency'], 'component');
  assert(row.placement.length > 0 && row.platform_requirements.every((id) => platformIds.has(id)),
    `component/${row.id} has incomplete placement or platform constraints`);
}
for (const row of system.parameters) has(row, ['exposure'], 'configuration');
for (const row of system.schemas) has(row, ['compatibility'], 'schema');
for (const row of system.interfaces) {
  has(row, ['protocol', 'errors', 'acceptance'], 'interface');
}
for (const row of system.calls) {
  has(row, ['from_component', 'to_component', 'interface_id', 'failure_propagation',
    'timeout_millis', 'retry_policy', 'idempotency'], 'call');
}
for (const row of system.events) {
  has(row, ['producer', 'channel', 'schema_id', 'owner', 'delivery', 'ordering',
    'idempotency', 'failure_propagation'], 'event');
}
for (const row of system.flows) has(row, ['idempotency', 'failure_propagation'], 'flow');
for (const row of system.topology) {
  has(row, ['storage_class', 'capabilities', 'isolation', 'placement', 'scale_min',
    'scale_max', 'platform_requirements'], 'topology');
}
for (const row of system.architecture) {
  has(row, ['owner', 'viewpoint', 'verifies', 'measurement'], 'architecture-binding');
}
for (const row of system.controls) has(row, ['owner', 'verification'], 'control');
for (const row of system.targets) {
  has(row, ['minimum_release_status', 'platform_requirements', 'storage_class', 'storage_profile', 'ingress_class_name',
    'ingress_controller_artifact'], 'target-binding');
  assert(row.platform_requirements.every((id) => platformIds.has(id)),
    `target-binding/${row.id} has an unknown platform requirement`);
}
validateTargetPolicies(system.targets);

const expectedPaths = [
  '/v1/calculations',
  '/v1/calculations/{request_id}',
];
assert(JSON.stringify(Object.keys(openapi.paths).sort()) === JSON.stringify(expectedPaths),
  'OpenAPI does not expose the exact three-operation HTTP surface');
assert(openapi.paths['/v1/calculations'].post && openapi.paths['/v1/calculations'].get,
  'OpenAPI collection GET or POST operation is absent');
assert(openapi.paths['/v1/calculations/{request_id}'].get,
  'OpenAPI item GET operation is absent');
assert(openapi.components.securitySchemes?.oidc?.type === 'openIdConnect',
  'OpenAPI OIDC security scheme is absent');
const history = openapi.components.schemas.HistoryRecord;
assert(history.additionalProperties === false, 'history schema is not closed');
for (const field of ['left', 'right']) {
  assert(history.properties[field].type === 'string' && history.properties[field].pattern,
    `${field} is not a canonical decimal string`);
}
assert(history.properties.sequence.type === 'string' && history.properties.sequence.pattern,
  'sequence is not a canonical unsigned decimal string');
assert(openapi.components.schemas.Error.additionalProperties === false,
  'the generated error envelope is not closed');

assert(asyncapi.asyncapi === '3.1.0', 'AsyncAPI is not version 3.1.0');
const channels = Object.values(asyncapi.channels ?? {});
assert(channels.length === 1, 'AsyncAPI must expose exactly one modeled event channel');
const payload = asyncapi.components?.messages?.CloudEvent?.payload;
assert(payload && payload.type === 'object' && Array.isArray(payload.required) &&
  payload.required.includes('data') && payload.properties?.data,
  'AsyncAPI CloudEvent payload is not a typed event envelope');
assert(cloudEvents.properties?.data?.type === 'object' &&
  Array.isArray(cloudEvents.properties.data.required) &&
  ['request_id', 'subject', 'operation', 'left', 'right', 'outcome'].every(
    (field) => cloudEvents.properties.data.required.includes(field)),
  'CloudEvents data does not type the canonical calculation fact');

const sql = await readFile(projection('history.sql'), 'utf8');
assert(!/\bBIGSERIAL\b/i.test(sql), 'modeled u64 sequence was narrowed to signed BIGSERIAL');
assert(/sequence\s+NUMERIC\s*\(\s*20\s*,\s*0\s*\)/i.test(sql),
  'database schema does not preserve the complete checked u64 range');
for (const table of ['command_history', 'command_outbox', 'command_audit']) {
  assert(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(sql),
    `owned PostgreSQL table ${table} is absent`);
}

const requiredServices = ['api', 'audit-worker', 'broker', 'browser', 'database', 'issuer', 'migrate', 'telemetry'];
assert(JSON.stringify(Object.keys(compose.services).sort()) === JSON.stringify(requiredServices),
  'Compose service closure differs from the modeled eight components');
for (const [name, service] of Object.entries(compose.services)) {
  assert(/@sha256:[0-9a-f]{64}$/.test(service.image), `Compose service ${name} image is not immutable`);
  assert(service.read_only === true, `Compose service ${name} root filesystem is writable`);
  assert(service.cap_drop?.includes('ALL'), `Compose service ${name} does not drop all capabilities`);
  assert(service.security_opt?.includes('no-new-privileges:true'),
    `Compose service ${name} permits privilege escalation`);
  assert(service.deploy?.resources?.limits && service.deploy?.resources?.reservations,
    `Compose service ${name} has no bounded resources`);
  if (name !== 'migrate') assert(service.healthcheck, `Compose service ${name} has no health check`);
}
assert(compose.secrets?.['oidc-signing-key']?.file ===
  '${PRISMPM_SECRET_DIR:?required}/calculator/oidc-signing-key',
'Compose does not bind the modeled late-bound OIDC signing key');
assert(compose.services.issuer.environment?.OIDC_SIGNING_KEY_FILE ===
  '/run/secrets/oidc-signing-key' &&
  compose.services.issuer.secrets?.some((row) =>
    row.source === 'oidc-signing-key' && row.target === 'oidc-signing-key'),
'Compose issuer does not consume only the modeled OIDC signing-key secret');

assert(kubernetes.kind === 'List', 'Kubernetes projection is not a closed List');
const resources = objects(kubernetes);
const kinds = new Set(resources.map((resource) => resource.kind));
for (const kind of [
  'Namespace', 'ServiceAccount', 'Role', 'RoleBinding', 'ConfigMap',
  'Deployment', 'StatefulSet', 'Job', 'Service', 'Ingress', 'IngressClass',
  'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass', 'NetworkPolicy',
  'PodDisruptionBudget',
]) assert(kinds.has(kind), `Kubernetes projection lacks ${kind}`);
for (const workload of resources.filter((row) => row.metadata?.namespace === 'calculator-system' &&
  ['Deployment', 'StatefulSet', 'Job'].includes(row.kind))) {
  const pod = workload.spec.template.spec;
  assert(pod.automountServiceAccountToken === false,
    `${workload.kind}/${workload.metadata.name} automounts a service-account token`);
  for (const container of [...(pod.initContainers ?? []), ...pod.containers]) {
    assert(/@sha256:[0-9a-f]{64}$/.test(container.image),
      `${workload.kind}/${workload.metadata.name} image is not immutable`);
    assert(container.resources?.requests && container.resources?.limits,
      `${workload.kind}/${workload.metadata.name} has no resource requests/limits`);
    const security = container.securityContext;
    const ownershipInitializer = (pod.initContainers ?? []).includes(container);
    if (ownershipInitializer) {
      assert(security?.allowPrivilegeEscalation === false && security?.readOnlyRootFilesystem === true &&
        security?.runAsNonRoot === false && security?.runAsUser === 0 &&
        JSON.stringify(security?.capabilities?.add) === JSON.stringify(['CHOWN']) &&
        security?.capabilities?.drop?.includes('ALL') && security?.seccompProfile?.type === 'RuntimeDefault',
      `${workload.kind}/${workload.metadata.name} volume ownership initializer exceeds its exact privilege`);
    } else {
      assert(security?.allowPrivilegeEscalation === false && security?.readOnlyRootFilesystem === true &&
        security?.runAsNonRoot === true && security?.capabilities?.drop?.includes('ALL') &&
        security?.seccompProfile?.type === 'RuntimeDefault',
      `${workload.kind}/${workload.metadata.name} container security is incomplete`);
    }
    if (!ownershipInitializer && workload.kind !== 'Job') {
      assert(container.startupProbe && container.readinessProbe && container.livenessProbe,
        `${workload.kind}/${workload.metadata.name} lacks startup/readiness/liveness probes`);
    }
  }
}
const referencedSecrets = new Set(resources.flatMap((resource) => {
  const volumes = resource.spec?.template?.spec?.volumes ?? [];
  return volumes.flatMap((volume) => volume.secret?.secretName ? [volume.secret.secretName] : []);
}));
for (const name of ['broker-credentials', 'database-credentials', 'oidc-signing-key']) {
  assert(referencedSecrets.has(name), `Kubernetes late-bound secret reference ${name} is absent`);
}
assert(!resources.some((row) => row.kind === 'Secret'),
'Kubernetes projection embedded late-bound secret material');
const issuerWorkload = resources.find((row) => row.kind === 'Deployment' &&
  row.metadata?.namespace === 'calculator-system' && row.metadata?.name === 'issuer');
const issuerContainer = issuerWorkload?.spec?.template?.spec?.containers?.find(
  (row) => row.name === 'issuer');
assert(issuerContainer?.env?.some((row) => row.name === 'OIDC_SIGNING_KEY_FILE' &&
  row.value === '/run/secrets/oidc-signing-key') &&
  issuerContainer?.volumeMounts?.some((row) => row.name === 'secret-oidc-signing-key' &&
    row.mountPath === '/run/secrets/oidc-signing-key' && row.subPath === 'value' &&
    row.readOnly === true),
'Kubernetes issuer does not consume the modeled OIDC signing key read-only');
const calculatorAccount = resources.find((row) => row.kind === 'ServiceAccount' &&
  row.metadata?.namespace === 'calculator-system' && row.metadata?.name === 'calculator-system');
const calculatorRole = resources.find((row) => row.kind === 'Role' &&
  row.metadata?.namespace === 'calculator-system' && row.metadata?.name === 'calculator-system');
const calculatorBinding = resources.find((row) => row.kind === 'RoleBinding' &&
  row.metadata?.namespace === 'calculator-system' && row.metadata?.name === 'calculator-system');
assert(calculatorAccount?.automountServiceAccountToken === false &&
  Array.isArray(calculatorRole?.rules) && calculatorRole.rules.length === 0 &&
  calculatorBinding?.roleRef?.kind === 'Role' &&
  calculatorBinding.roleRef.name === 'calculator-system' &&
  calculatorBinding.subjects?.length === 1 &&
  calculatorBinding.subjects[0]?.kind === 'ServiceAccount' &&
  calculatorBinding.subjects[0]?.name === 'calculator-system' &&
  calculatorBinding.subjects[0]?.namespace === 'calculator-system',
'Kubernetes application identity is not namespace-scoped least privilege');
const ingress = resources.find((row) => row.kind === 'Ingress');
assert(ingress.spec.tls?.[0]?.secretName === 'tls-certificate', 'Kubernetes TLS ingress binding is absent');
assert(ingress.spec.ingressClassName === 'nginx', 'Kubernetes Ingress does not select the modeled class');
const ingressPaths = ingress.spec.rules?.[0]?.http?.paths ?? [];
assert(ingressPaths.some((row) => row.path === '/v1/calculations' &&
  row.backend?.service?.name === 'api'), 'Kubernetes Ingress does not route the modeled API');
assert(ingressPaths.some((row) => row.path === '/' &&
  row.backend?.service?.name === 'browser'), 'Kubernetes Ingress does not route the modeled View');
const browserWorkload = resources.find((row) => row.kind === 'Deployment' && row.metadata?.name === 'browser');
assert(!(browserWorkload?.spec?.template?.spec?.volumes ?? []).some(
  (volume) => volume.secret?.secretName === 'tls-certificate'),
'Kubernetes browser mounts the TLS key even though TLS terminates at Ingress');

const storageClass = resources.find((row) => row.kind === 'StorageClass' &&
  row.metadata?.name === 'kind-static-local');
assert(storageClass?.provisioner === 'kubernetes.io/no-provisioner' &&
  storageClass?.reclaimPolicy === 'Retain' &&
  storageClass?.volumeBindingMode === 'WaitForFirstConsumer',
'modeled static Kind StorageClass policy is incomplete');
const claims = resources.filter((row) => row.kind === 'PersistentVolumeClaim');
const volumes = resources.filter((row) => row.kind === 'PersistentVolume');
assert(claims.length === 2 && volumes.length === 2,
  'Kubernetes must project exactly the modeled database and broker persistent volumes');
for (const claim of claims) {
  const volume = volumes.find((row) => row.metadata?.name === claim.spec?.volumeName);
  assert(claim.spec.storageClassName === 'kind-static-local' && volume,
    `PVC/${claim.metadata.name} is not deterministically bound to a static volume`);
  assert(volume.spec.storageClassName === 'kind-static-local' &&
    volume.spec.persistentVolumeReclaimPolicy === 'Retain' &&
    volume.spec.claimRef?.name === claim.metadata.name &&
    volume.spec.claimRef?.namespace === 'calculator-system' &&
    volume.spec.hostPath?.type === 'DirectoryOrCreate',
  `PersistentVolume/${volume.metadata.name} does not preserve the modeled binding/retention`);
}

const controller = resources.find((row) => row.kind === 'Deployment' &&
  row.metadata?.namespace === 'ingress-nginx' && row.metadata?.name === 'ingress-nginx-controller');
assert(controller, 'the pinned ingress controller deployment is absent');
assert(controller.spec.template.spec.containers.some((container) =>
  container.image === 'registry.k8s.io/ingress-nginx/controller:v1.15.1@sha256:594ceea76b01c592858f803f9ff4d2cb40542cae2060410b2c95f75907d659e1'),
'the ingress controller image differs from its pinned modeled bundle');
const controllerPolicy = resources.find((row) => row.kind === 'NetworkPolicy' &&
  row.metadata?.name === 'ingress-controller-backends' &&
  row.metadata?.namespace === 'calculator-system');
const controllerSource = controllerPolicy?.spec?.ingress?.[0]?.from?.[0];
assert(controllerSource?.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'] === 'ingress-nginx' &&
  controllerSource?.podSelector?.matchLabels?.['app.kubernetes.io/component'] === 'controller',
'backend ingress is not restricted to the selected controller identity');
assert(resources.filter((row) => row.kind === 'NetworkPolicy').some(
  (row) => row.metadata.name === 'default-deny' && row.metadata.namespace === 'calculator-system'),
'Kubernetes application default-deny NetworkPolicy is absent');

for (const pipeline of ['logs', 'metrics', 'traces']) {
  const processors = collector.service?.pipelines?.[pipeline]?.processors ?? [];
  assert(processors.includes('attributes/redact'), `${pipeline} does not apply modeled redaction`);
}
const deleted = new Set((collector.processors?.['attributes/redact']?.actions ?? [])
  .filter((row) => row.action === 'delete').map((row) => row.key));
for (const field of ['authorization', 'client_label', 'history', 'left', 'right', 'secret', 'token']) {
  assert(deleted.has(field), `Collector does not redact ${field}`);
}

const browserClosure = (await readdir(join(root, 'production-browser'))).sort();
assert(browserClosure.includes('index.html') && browserClosure.includes('app.js') &&
  browserClosure.includes('openapi-client.js'), 'generated production View closure is incomplete');
const browser = await readFile(join(root, 'production-browser', 'app.js'), 'utf8');
const browserHtml = await readFile(join(root, 'production-browser', 'index.html'), 'utf8');
assert(browser.includes('from"./openapi-client.js"') || browser.includes("from './openapi-client.js'"),
  'production View does not exclusively consume the generated OpenAPI client');
assert(browserHtml.includes('<option value="">No application access</option>'),
  'production View has no modeled denied-principal choice');
assert(browser.includes('roles:selectedRole?[selectedRole]:[]'),
  'production View does not request a real empty-role OIDC principal for access-denied acceptance');
assert(browser.includes('function clearIdentityData()') &&
  browser.includes('byId("records").replaceChildren()') &&
  browser.includes('clearIdentityData();status(contract.view.authenticating_text)'),
  'production View does not clear prior-identity data before authentication');
assert(browser.includes('byId("retry").hidden=true;status(contract.view.loading_text)'),
  'production View does not clear stale retry state before a history request');

process.stdout.write(`Calculator system projections ${expectedRelease} verified\n`);
