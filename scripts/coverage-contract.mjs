const byteCompare = (left, right) => Buffer.from(left).compare(Buffer.from(right));
const featurePattern = /^(?:AU|SY|DK|OC|LC|DP|OP|SC|TM)-\d\d$/;
const diagnosticPattern = /^PP\d{4}$/;
const forbidden = /(?:not[- ]applicable|not[- ]executed|skipped|placeholder|todo)/i;

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort(byteCompare)) !==
        JSON.stringify([...expected].sort(byteCompare))) {
    throw new Error(`${label} has missing or unknown fields`);
  }
};

const sortedUnique = (values, label) => {
  if (!Array.isArray(values) || values.length === 0 ||
      new Set(values).size !== values.length ||
      JSON.stringify(values) !== JSON.stringify([...values].sort(byteCompare))) {
    throw new Error(`${label} is not a nonempty byte-sorted unique array`);
  }
};

const authorityIds = (standards) => {
  if (standards?.schema !== 'prismpm/standards-lock/1' ||
      !Array.isArray(standards.authorities)) {
    throw new Error('standards.lock does not contain the authoritative authority set');
  }
  const ids = standards.authorities.map((row) => row?.id);
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new Error('standards.lock authority IDs are malformed or duplicated');
  }
  return new Set(ids);
};

const validateAuthorities = (binding, known, label) => {
  if (binding?.kind === 'present') {
    exactKeys(binding, ['ids', 'kind'], label);
    sortedUnique(binding.ids, `${label}.ids`);
    for (const id of binding.ids) {
      if (!known.has(id)) throw new Error(`${label} names unknown authority ${id}`);
    }
    return;
  }
  if (binding?.kind === 'none') {
    exactKeys(binding, ['kind', 'reason'], label);
    if (typeof binding.reason !== 'string' || binding.reason.length === 0 ||
        binding.reason.length > 1024 || forbidden.test(binding.reason)) {
      throw new Error(`${label}.reason is absent, oversized, or evasive`);
    }
    return;
  }
  throw new Error(`${label} is not an explicit present/none authority binding`);
};

const requireText = (row, fields, label) => {
  for (const field of fields) {
    if (typeof row[field] !== 'string' || row[field].length === 0) {
      throw new Error(`${label} has no ${field}`);
    }
  }
};

export function validateCoverage(document, standards) {
  exactKeys(document, ['diagnostics', 'features', 'model_digest', 'schema'], 'coverage');
  if (document.schema !== 'prismpm/capability-coverage/1') {
    throw new Error('unexpected public feature coverage schema');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(document.model_digest ?? '')) {
    throw new Error('public feature coverage has no exact model digest');
  }
  const knownAuthorities = authorityIds(standards);
  if (!Array.isArray(document.features) || document.features.length !== 147) {
    throw new Error(`public feature coverage has ${document.features?.length ?? 0} rows instead of 147`);
  }
  const featureIds = document.features.map((row) => row.feature_id);
  sortedUnique(featureIds, 'public feature IDs');
  for (const row of document.features) {
    const label = `feature ${row.feature_id ?? '<unknown>'}`;
    exactKeys(row, [
      'command', 'feature_id', 'generated_outputs', 'model_source', 'negative_evidence',
      'negative_scenario', 'positive_evidence', 'positive_scenario', 'standard_authorities',
      'statement', 'suite', 'visibility',
    ], label);
    if (!featurePattern.test(row.feature_id ?? '')) throw new Error(`invalid feature ID: ${row.feature_id}`);
    requireText(row, [
      'command', 'negative_evidence', 'negative_scenario', 'positive_evidence',
      'positive_scenario', 'statement', 'suite',
    ], label);
    if (row.visibility !== 'public') throw new Error(`${label} is not public`);
    if (row.model_source !== `model/ids.toml#${row.feature_id}`) {
      throw new Error(`${label} model_source is not its exact registered model row`);
    }
    const output = `projections/capability-coverage.json#feature=${row.feature_id}`;
    if (JSON.stringify(row.generated_outputs) !== JSON.stringify([output])) {
      throw new Error(`${label} generated_outputs does not bind its exact projection row`);
    }
    for (const field of ['command', 'positive_evidence', 'negative_evidence']) {
      if (!row[field].includes(row.feature_id)) throw new Error(`${label} ${field} is not feature-specific`);
    }
    validateAuthorities(row.standard_authorities, knownAuthorities,
      `${label}.standard_authorities`);
  }

  if (!Array.isArray(document.diagnostics) || document.diagnostics.length !== 83) {
    throw new Error(`diagnostic-family coverage has ${document.diagnostics?.length ?? 0} rows instead of 83`);
  }
  const codes = document.diagnostics.map((row) => row.code);
  sortedUnique(codes, 'diagnostic codes');
  for (const row of document.diagnostics) {
    const label = `diagnostic ${row.code ?? '<unknown>'}`;
    exactKeys(row, [
      'class', 'code', 'command', 'evidence', 'generated_outputs', 'model_source',
      'scenario', 'standard_authorities', 'statement', 'visibility',
    ], label);
    if (!diagnosticPattern.test(row.code ?? '')) throw new Error(`invalid diagnostic code: ${row.code}`);
    requireText(row, ['class', 'command', 'evidence', 'scenario', 'statement'], label);
    if (row.visibility !== 'public') throw new Error(`${label} is not public`);
    if (row.model_source !== `model/errors.toml#${row.code}`) {
      throw new Error(`${label} model_source is not its exact registered model row`);
    }
    const output = `projections/capability-coverage.json#diagnostic=${row.code}`;
    if (JSON.stringify(row.generated_outputs) !== JSON.stringify([output])) {
      throw new Error(`${label} generated_outputs does not bind its exact projection row`);
    }
    for (const field of ['command', 'evidence']) {
      if (!row[field].includes(row.code)) throw new Error(`${label} ${field} is not diagnostic-specific`);
    }
    validateAuthorities(row.standard_authorities, knownAuthorities,
      `${label}.standard_authorities`);
  }

  for (const row of [...document.features, ...document.diagnostics]) {
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && forbidden.test(value)) {
        throw new Error(`coverage row ${row.feature_id ?? row.code} contains an exclusion: ${value}`);
      }
    }
  }
}
