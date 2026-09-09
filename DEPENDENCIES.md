# Dependency policy

- Rust, Node.js, Lean, Playwright Chromium, PrismPM, and every CI action are
  pinned to an exact version, commit, image digest, checksum, or action SHA.
- `prism-calculator` and its sole runtime dependency `prism-stdlib` use exact
  Cargo versions from the public Cargo registry. No repository-local registry,
  path dependency, Git dependency, or source replacement is permitted.
- Dependency download is allowed during devcontainer setup. Acceptance runs
  locked and offline afterward.
- Runtime Pages assets are a closed same-origin bundle with no CDN, analytics,
  telemetry, or network calculation fallback.
- `prismpm.lock` closes the SDK commands, adapters, oracles, schemas, crates,
  workflows, base images, and standards lock under one immutable image digest.
- Automated dependency updates may propose changes, but Cargo, SDK, template,
  model, and generated artifact changes require the complete `just vv` gate.
