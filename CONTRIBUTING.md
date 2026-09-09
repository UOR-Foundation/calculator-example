# Contributing

`src/Calculator.lex.tex` is a byte-for-byte mirror of PrismPM's canonical
getting-started application. `src/CalculatorSystem.lex.tex` is the authority
for its A/B production system. Behavior and presentation must be changed in
the appropriate authoritative `.lex.tex` model and generated through LexLean
and PrismPM. Handwritten Lean, arithmetic, protocol handling, HTML, CSS,
JavaScript, Rust UI behavior, infrastructure behavior, or fallback calculation
is not accepted.

Before opening a change, use the repository devcontainer and run `just vv`.
Commit regenerated artifacts, `SHA256SUMS`, and generated digest-bound evidence
together. GitHub Actions are SHA-pinned; dependency changes require a review of
their source, license, lockfile entry, and generated output impact.
