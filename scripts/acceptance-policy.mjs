const requiredDispatch = `case "$suite" in
  pages) pages_acceptance ;;
  compose) compose_acceptance ;;
  conformance) conformance_acceptance ;;
  kind) kind_acceptance ;;
  roundtrip) roundtrip_acceptance ;;
  system)
    compose_acceptance
    kind_acceptance
    conformance_acceptance
    ;;
  all)
    require_published_releases
    pages_acceptance
    compose_acceptance
    kind_acceptance
    conformance_acceptance
    roundtrip_acceptance
    ;;
esac
`;

export function validateAcceptanceDispatch(source) {
  if (typeof source !== 'string' || !source.endsWith(requiredDispatch)) {
    throw new Error('acceptance dispatch narrows or conditionally omits a required suite');
  }
}

export function validateRepositoryAcceptance(source) {
  if (typeof source !== 'string' ||
      !source.includes('./scripts/acceptance.sh system "$mode"') ||
      source.includes('./scripts/acceptance.sh compose "$mode"') ||
      source.includes('./scripts/acceptance.sh kind "$mode"') ||
      source.includes('./scripts/acceptance.sh conformance "$mode"')) {
    throw new Error('repository verification bypasses the complete protected system dispatch');
  }
}
