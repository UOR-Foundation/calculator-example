# Repository instructions

- Run all implementation and verification in this repository's devcontainer.
- `src/Calculator.lex.tex` and its lock/config closure mirror
  `vendor/PrismPM/examples/Calculator` exactly.
- Never handwrite Lean or application-specific Rust, HTML, CSS, or JavaScript.
- Regenerate derived artifacts with the pinned PrismPM submodule.
- Run `just vv` before committing. Do not weaken its identity, reproducibility,
  offline, browser, accessibility, or exact-file-closure checks.
