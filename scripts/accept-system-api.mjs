#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

const baseUrl = (process.env.CALCULATOR_PRODUCTION_URL ?? 'https://127.0.0.1:8080').replace(/\/$/, '');
const expectedRelease = process.env.CALCULATOR_EXPECTED_RELEASE;
if (!['A', 'B'].includes(expectedRelease)) {
  throw new Error('CALCULATOR_EXPECTED_RELEASE must be A or B');
}
const prefix = `system-${expectedRelease.toLowerCase()}-${process.pid}`;
const observed = [];
const connectAddress = process.env.CALCULATOR_CONNECT_ADDRESS;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function call(path, options = {}, status = 200, code) {
  const url = new URL(`${baseUrl}${path}`);
  const textResponse = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
      headers: { ...options.headers, host: url.host },
      hostname: connectAddress ?? url.hostname,
      method: options.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
      servername: url.hostname,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ body, status: response.statusCode }));
    });
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
  const text = textResponse.body;
  const value = text ? JSON.parse(text) : null;
  assert.equal(textResponse.status, status, `${options.method ?? 'GET'} ${path}: ${text}`);
  if (code) {
    assert.deepEqual(Object.keys(value ?? {}), ['error']);
    assert.deepEqual(Object.keys(value.error ?? {}), ['code']);
    assert.equal(value.error.code, code);
  }
  observed.push({ method: options.method ?? 'GET', path, status });
  return value;
}

async function token(subject, roles, conformance) {
  const response = await call('/oidc/token', {
    body: canonical({ ...(conformance ? { conformance } : {}), roles, sub: subject }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assert.equal(response.token_type, 'Bearer');
  return response.access_token;
}

const user = await token(`${prefix}-user`, ['calculator.user']);
const other = await token(`${prefix}-other`, ['calculator.user']);
const auditor = await token(`${prefix}-auditor`, ['calculator.auditor']);
const userAuditor = await token(`${prefix}-user-auditor`, ['calculator.auditor', 'calculator.user']);
const noRole = await token(`${prefix}-none`, []);
const maximumSubject = 's'.repeat(255);
const maximumSubjectToken = await token(maximumSubject, ['calculator.user']);
const auth = (value) => ({ authorization: `Bearer ${value}` });
const json = (value) => ({ ...auth(value), 'content-type': 'application/json' });
const collection = '/v1/calculations';

await call('/oidc/token', {
  body: canonical({ roles: ['calculator.user'], sub: '' }),
  headers: { 'content-type': 'application/json' }, method: 'POST',
}, 400, 'MalformedJson');
await call('/oidc/token', {
  body: canonical({ roles: ['calculator.user'], sub: 'x'.repeat(256) }),
  headers: { 'content-type': 'application/json' }, method: 'POST',
}, 400, 'MalformedJson');
await call('/oidc/token', {
  body: canonical({ roles: ['calculator.user'], sub: 'café' }),
  headers: { 'content-type': 'application/json' }, method: 'POST',
}, 400, 'MalformedJson');
await call(collection, {}, 401, 'Unauthenticated');
await call(collection, { headers: auth('malformed.jwt') }, 401, 'Unauthenticated');
for (const conformance of ['expired', 'unknown-key', 'wrong-audience', 'wrong-issuer']) {
  await call(collection, { headers: auth(await token(`${prefix}-${conformance}`, ['calculator.user'], conformance)) },
    401, 'Unauthenticated');
}
await call(collection, { headers: auth(noRole) }, 403, 'Forbidden');

await call(collection, { body: '{', headers: json(user), method: 'POST' }, 400, 'MalformedJson');
for (const primitive of ['null', '[]', '"value"', '1', 'true']) {
  await call(collection, { body: primitive, headers: json(user), method: 'POST' },
    400, 'MalformedJson');
}
await call(collection, { body: '{}', headers: json(user), method: 'POST' }, 400, 'MalformedJson');
await call(collection, {
  body: '{}', headers: { ...auth(user), 'content-type': 'application/json; charset=utf-8' }, method: 'POST',
}, 400, 'MalformedJson');
for (const request of [
  { left: 1, operation: 'add', request_id: `${prefix}-numeric-left`, right: '2' },
  { left: '1', operation: 'power', request_id: `${prefix}-unknown-operation`, right: '2' },
  { extra: true, left: '1', operation: 'add', request_id: `${prefix}-extra-field`, right: '2' },
]) {
  await call(collection, { body: canonical(request), headers: json(user), method: 'POST' },
    400, 'MalformedJson');
}
await call(collection, { body: ' '.repeat(16385), headers: json(user), method: 'POST' }, 413, 'OversizedInput');
await call(collection, { body: '{}', headers: auth(user), method: 'POST' }, 415, 'UnsupportedMedia');
await call(collection, {
  body: '{}', headers: { ...auth(user), 'content-type': 'application/jsonp' }, method: 'POST',
}, 415, 'UnsupportedMedia');
await call(collection, { headers: auth(user), method: 'PUT' }, 405, 'UnsupportedMethod');
for (const [name, value] of [['plus', '+1'], ['leading-zero', '01'], ['negative-zero', '-0'],
  ['above-max', '9223372036854775808'], ['below-min', '-9223372036854775809']]) {
  await call(collection, {
    body: canonical({ left: value, operation: 'add', request_id: `${prefix}-${name}`, right: '0' }),
    headers: json(user), method: 'POST',
  }, 400, 'MalformedJson');
}
for (const [suffix, requestId] of [
  ['digit-prefix', '1invalid'],
  ['uppercase', 'Invalid'],
  ['underscore', 'invalid_request'],
  ['too-long', `r${'x'.repeat(63)}`],
]) {
  await call(collection, {
    body: canonical({ left: '1', operation: 'add', request_id: requestId, right: '2' }),
    headers: json(user), method: 'POST',
  }, 400, 'MalformedJson');
}

const vectors = [
  ['add-max', 'add', '9223372036854775807', '0', 200, '9223372036854775807'],
  ['add-overflow', 'add', '9223372036854775807', '1', 422, 'Overflow'],
  ['subtract-min', 'subtract', '-9223372036854775808', '0', 200, '-9223372036854775808'],
  ['subtract-overflow', 'subtract', '-9223372036854775808', '1', 422, 'Overflow'],
  ['multiply', 'multiply', '-9223372036854775808', '1', 200, '-9223372036854775808'],
  ['multiply-overflow', 'multiply', '9223372036854775807', '2', 422, 'Overflow'],
  ['divide-overflow', 'divide', '-9223372036854775808', '-1', 422, 'Overflow'],
  ['divide-zero', 'divide', '1', '0', 422, 'DivisionByZero'],
];
const created = [];
for (const [suffix, operation, left, right, status, expected] of vectors) {
  const requestId = `${prefix}-${suffix}`;
  const request = { left, operation, request_id: requestId, right };
  if (expectedRelease === 'B') request.client_label = 'Café';
  const row = await call(collection, { body: canonical(request), headers: json(user), method: 'POST' }, status);
  assert.equal(row.request_id, requestId);
  assert.equal(row.subject, `${prefix}-user`);
  assert.equal(row.outcome.kind, status === 200 ? 'succeeded' : 'rejected');
  assert.equal(status === 200 ? row.outcome.result : row.outcome.error, expected);
  assert.match(row.sequence, /^(?:0|[1-9][0-9]*)$/);
  created.push({ request, row, status });
}
const maximumRequestId = `r${'x'.repeat(62)}`;
const maximumRequest = {
  left: '20', operation: 'add', request_id: maximumRequestId, right: '22',
  ...(expectedRelease === 'B' ? { client_label: 'maximum request identity' } : {}),
};
const maximumRequestRow = await call(collection, {
  body: canonical(maximumRequest), headers: json(user), method: 'POST',
});
assert.equal(maximumRequestRow.request_id, maximumRequestId);

const idempotent = created[0];
assert.deepEqual(await call(collection, {
  body: canonical(idempotent.request), headers: json(user), method: 'POST',
}, idempotent.status), idempotent.row);
const reorderedRequest = `{"right":${JSON.stringify(idempotent.request.right)},"request_id":${JSON.stringify(idempotent.request.request_id)},"operation":${JSON.stringify(idempotent.request.operation)},"left":${JSON.stringify(idempotent.request.left)}${expectedRelease === 'B' ? `,"client_label":${JSON.stringify(idempotent.request.client_label)}` : ''}}`;
assert.deepEqual(await call(collection, {
  body: reorderedRequest, headers: json(user), method: 'POST',
}, idempotent.status), idempotent.row, 'equivalent JSON did not resolve to the same canonical request');
const rejectedIdempotent = created.find(({ status }) => status === 422);
assert.deepEqual(await call(collection, {
  body: canonical(rejectedIdempotent.request), headers: json(user), method: 'POST',
}, 422), rejectedIdempotent.row, 'a recorded domain error was not idempotent');
await call(collection, {
  body: canonical({ ...idempotent.request, right: '1' }), headers: json(user), method: 'POST',
}, 409, 'IdempotencyConflict');
await call(collection, {
  body: canonical(idempotent.request), headers: json(other), method: 'POST',
}, 409, 'IdempotencyConflict');
await call(`${collection}/${idempotent.row.request_id}`, { headers: auth(other) }, 404, 'NotFound');
assert.deepEqual(await call(`${collection}/${idempotent.row.request_id}`, { headers: auth(user) }), idempotent.row);
assert.deepEqual(await call(`${collection}/${idempotent.row.request_id}`, { headers: auth(auditor) }), idempotent.row);
await call(`${collection}/${prefix}-never-created`, { headers: auth(user) }, 404, 'NotFound');
await call(collection, {
  body: canonical({ ...idempotent.request, request_id: `${prefix}-auditor-write` }),
  headers: json(auditor), method: 'POST',
}, 403, 'Forbidden');
const combinedRoleRequest = {
  left: '20', operation: 'add', request_id: `${prefix}-combined-role`, right: '22',
  ...(expectedRelease === 'B' ? { client_label: 'combined role' } : {}),
};
const combinedRoleRow = await call(collection, {
  body: canonical(combinedRoleRequest), headers: json(userAuditor), method: 'POST',
});
assert.equal(combinedRoleRow.outcome.result, '42');
const maximumSubjectRequest = {
  left: '1', operation: 'add', request_id: `${prefix}-maximum-subject`, right: '1',
  ...(expectedRelease === 'B' ? { client_label: 'maximum subject' } : {}),
};
const maximumSubjectRow = await call(collection, {
  body: canonical(maximumSubjectRequest), headers: json(maximumSubjectToken), method: 'POST',
});
assert.equal(maximumSubjectRow.subject, maximumSubject);

if (expectedRelease === 'A') {
  await call(collection, {
    body: canonical({ ...idempotent.request, client_label: 'label', request_id: `${prefix}-label` }),
    headers: json(user), method: 'POST',
  }, 400, 'MalformedJson');
} else {
  await call(collection, {
    body: canonical({ ...idempotent.request, client_label: 1, request_id: `${prefix}-numeric-label` }),
    headers: json(user), method: 'POST',
  }, 400, 'MalformedJson');
  const optionalLabelRequest = {
    left: '1', operation: 'add', request_id: `${prefix}-label-absent`, right: '2',
  };
  const optionalLabelRow = await call(collection, {
    body: canonical(optionalLabelRequest), headers: json(user), method: 'POST',
  });
  assert.equal(optionalLabelRow.client_label, null);
  const scalarBoundaryRequest = {
    client_label: '😀'.repeat(128), left: '2', operation: 'add',
    request_id: `${prefix}-label-scalar-boundary`, right: '3',
  };
  const scalarBoundaryRow = await call(collection, {
    body: canonical(scalarBoundaryRequest), headers: json(user), method: 'POST',
  });
  assert.equal([...scalarBoundaryRow.client_label].length, 128);
  await call(collection, {
    body: canonical({ ...idempotent.request, client_label: 'e\u0301', request_id: `${prefix}-non-nfc` }),
    headers: json(user), method: 'POST',
  }, 400, 'MalformedJson');
  await call(collection, {
    body: canonical({ ...idempotent.request, client_label: 'x'.repeat(129), request_id: `${prefix}-long-label` }),
    headers: json(user), method: 'POST',
  }, 400, 'MalformedJson');
}

const concurrentId = `${prefix}-concurrent`;
const concurrentRequest = { left: '6', operation: 'multiply', request_id: concurrentId, right: '7' };
if (expectedRelease === 'B') concurrentRequest.client_label = 'concurrent';
const concurrent = await Promise.all(Array.from({ length: 16 }, () => call(collection, {
  body: canonical(concurrentRequest), headers: json(user), method: 'POST',
})));
assert(concurrent.every((row) => canonical(row) === canonical(concurrent[0])),
  'concurrent idempotent responses differ');

const otherRequest = { left: '1', operation: 'add', request_id: `${prefix}-other-only`, right: '1' };
if (expectedRelease === 'B') otherRequest.client_label = 'other';
await call(collection, { body: canonical(otherRequest), headers: json(other), method: 'POST' });
const paginationRequests = Array.from({ length: 26 }, (_, index) => ({
  left: String(index), operation: 'add', request_id: `${prefix}-page-${index}`, right: '1',
  ...(expectedRelease === 'B' ? { client_label: `page-${index}` } : {}),
}));
await Promise.all(paginationRequests.map((request) => call(collection, {
  body: canonical(request), headers: json(user), method: 'POST',
})));

const firstPage = await call(`${collection}?after=0&limit=2`, { headers: auth(user) });
assert.equal(firstPage.records.length, 2);
assert(BigInt(firstPage.records[0].sequence) < BigInt(firstPage.records[1].sequence));
const secondPage = await call(`${collection}?after=${firstPage.records[1].sequence}&limit=100`,
  { headers: auth(user) });
assert(secondPage.records.every((row) => BigInt(row.sequence) > BigInt(firstPage.records[1].sequence)));
assert(secondPage.records.every((row, index, rows) =>
  index === 0 || BigInt(rows[index - 1].sequence) < BigInt(row.sequence)),
'history continuation is not strictly ascending by database sequence');
assert(secondPage.records.every((row) => row.subject === `${prefix}-user`));
assert(!secondPage.records.some((row) => row.request_id === otherRequest.request_id));
const all = [...firstPage.records, ...secondPage.records];
assert.equal(all.filter((row) => row.request_id === concurrentId).length, 1,
  'concurrent request was stored more than once');
const auditPage = await call(`${collection}?after=0&limit=100`, { headers: auth(auditor) });
assert(auditPage.records.every((row, index, rows) =>
  index === 0 || BigInt(rows[index - 1].sequence) < BigInt(row.sequence)),
'auditor history is not strictly ascending by database sequence');
assert(auditPage.records.some((row) => row.request_id === concurrentId));
assert(auditPage.records.some((row) => row.request_id === otherRequest.request_id));
const defaultPage = await call(collection, { headers: auth(user) });
assert.equal(defaultPage.records.length, 25, 'history default limit is not 25');
await call(`${collection}?after=0&limit=0`, { headers: auth(user) }, 400, 'MalformedJson');
await call(`${collection}?after=0&limit=101`, { headers: auth(user) }, 400, 'MalformedJson');
await call(`${collection}?after=-1&limit=1`, { headers: auth(user) }, 400, 'MalformedJson');
await call(`${collection}?after=01&limit=1`, { headers: auth(user) }, 400, 'MalformedJson');
const maximumSequencePage = await call(
  `${collection}?after=18446744073709551615&limit=1`, { headers: auth(user) });
assert.deepEqual(maximumSequencePage.records, []);
await call(`${collection}?after=18446744073709551616&limit=1`, { headers: auth(user) }, 400, 'MalformedJson');

process.stdout.write(`${canonical({
  check_count: observed.length,
  concurrent_request_id: concurrentId,
  concurrent_subject: `${prefix}-user`,
  created_request_ids: created.map(({ row }) => row.request_id),
  rejected_request_id: rejectedIdempotent.row.request_id,
  release: expectedRelease,
  schema: 'calculator/system-api-acceptance/1',
  status: 'passed',
})}\n`);
