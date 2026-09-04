# Dependency policy

- Rust, Node.js, Lean, Playwright Chromium, PrismPM, and every CI action are
  pinned to an exact version, commit, image digest, checksum, or action SHA.
- `prism-calculator` and its sole runtime dependency `prism-stdlib` use exact
  Cargo versions. Candidate verification uses only the checked-in
  registry-format package bytes and validates their SHA-256 checksums.
- Dependency download is allowed during devcontainer setup. Acceptance runs
  locked and offline afterward.
- Runtime Pages assets are a closed same-origin bundle with no CDN, analytics,
  telemetry, or network calculation fallback.
- Automated dependency updates may propose changes, but lockfile and generated
  artifact changes require the complete `just vv` gate.
