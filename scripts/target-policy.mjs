const expected = new Map([
  ['compose-local', 'development'],
  ['github-pages', 'accepted'],
  ['kubernetes-kind', 'development'],
]);

export function validateTargetPolicies(targets, field = 'minimum_release_status') {
  if (!Array.isArray(targets) || targets.length !== expected.size) {
    throw new Error('Calculator target release-policy closure changed');
  }
  const seen = new Set();
  for (const target of targets) {
    const id = target?.id;
    if (!expected.has(id) || seen.has(id)) {
      throw new Error(`Calculator target release-policy identity is unknown or duplicated: ${id}`);
    }
    seen.add(id);
    if (!Object.hasOwn(target, field)) {
      throw new Error(`target ${id} omits ${field}`);
    }
    const minimum = target[field];
    if (!['development', 'candidate', 'accepted'].includes(minimum)) {
      throw new Error(`target ${id} has invalid ${field}`);
    }
    if (minimum !== expected.get(id)) {
      throw new Error(`target ${id} weakens or changes its modeled release policy`);
    }
  }
}
