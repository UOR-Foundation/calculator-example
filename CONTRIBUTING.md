# Contributing

The Calculator model under `src/` is a byte-for-byte mirror of PrismPM's
canonical getting-started application. Application behavior and presentation
must be changed in that authoritative `.lex.tex` model and generated through
LexLean and PrismPM. Handwritten Lean, arithmetic, protocol handling, HTML,
CSS, JavaScript, Rust UI behavior, or fallback calculation is not accepted.

Before opening a change, use the repository devcontainer and run `just vv`.
Commit regenerated artifacts, `SHA256SUMS`, and the release-candidate identity
record together. GitHub Actions are SHA-pinned; dependency changes require a
review of their source, license, lockfile entry, and generated output impact.
