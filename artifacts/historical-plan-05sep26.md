# PrismPM Holo/1 and Calculator completion plan

This file contains only work that remains after auditing the implementation
described by `past/01sep26.md`. The detailed first-release plan is preserved as
`past/02sep26.md`; completed behavior from that plan is a regression baseline
and must not be discarded while completing the work below.

The audit was performed on 2 September 2026 against these clean revisions:

| Repository | Revision |
| --- | --- |
| `UOR-Foundation/PrismPM` | `08c225e6852292ca52023374b3d5fbcea1af481f` (`v0.1.0`) |
| `afflom/LexLean` | `79371e16027d0864e014e3ce1f8f95745ce5caaa` |
| audited local `lean4-prod` checkout | `d618fd2f305e9d46319bda113fef601f01624ed3` |
| accepted `auser/lean4-prod:main` base | `80634f290ca4146a4908f27f5e2f2e6f1141425f` (edited/squashed PR #23) |
| current `afflom/lean4-prod:main` tip | `f5367291b0146433ee17b58fc6ca49f593c22c52` (tree-identical to `80634f2`, history-divergent) |

After the audit, the local lean4-prod branch was fast-forwarded to `f536729`
and joined to accepted upstream `80634f2` by the no-content merge
`388f586c5bf74299d019c16463964db070f37c84`. The resulting tree is
byte-identical to `80634f2`, has it as an ancestor, and passes devcontainer
`just ci`. The merge is deliberately not described as published evidence:
`afflom/main` remains at `f536729` until the guarded push in Task 3.

All implementation and verification work must run in each repository's
devcontainer. The host supplies only Git, Docker, Buildx, the Dev Container CLI,
and repository credentials.

**Normative completion boundary:** the existing `v0.1.0` release is an audited
historical prototype, not a completed PrismPM. PrismPM may not be described as
complete, production-ready, or generally released until `prism-stdlib`, the
fully modeled Calculator application, its `.holo` and Cargo artifacts, and
`UOR-Foundation/calculator-example` simultaneously satisfy every application
acceptance and final definition-of-done item in this file. Component-level
success is progress evidence only; there is no partial PrismPM completion
state and no release waiver for an unavailable registry, GitHub Pages,
Hologram View surface, or external repository.

## Audit of `past/01sep26.md`

| Historical task | Audit disposition | Evidence and remaining consequence |
| --- | --- | --- |
| 1. Repository and tools | Complete for the historical scope | The three repositories are clean at the recorded commits; Docker 29.1.3, Buildx 0.36.1, and Dev Container CLI 0.88.0 start the pinned development containers. Preserve these gates. |
| 2. Normative contract | Superseded in part | The 93-row register and 32-code diagnostic model are internally complete, but `SPEC.md` incorrectly defines `.holo` as Prism canonical JSON. Rewrite the affected contract and register before implementation. |
| 3. LexLean 1.1 | Complete for the historical scope; extension required | Existing 1.1 declarations, snapshots, generated Lean, and verification pass. The closed semantic language lacks the signed/fixed-width integer, string/byte, binary-codec, and operation forms required by the real Holo format and Calculator. |
| 4. `lean4-prod` | Complete for the historical scope; upstream synchronization and extension required | Named Lean 4.32.1 export and the existing scalar/list Rust path pass. Auser merged edited/squashed PR #23 as `80634f2`; the fork tip `f536729` has the same tree but divergent history, so new work must first join that accepted ancestry without replaying the old commits. Int operators are not admitted by the Lean lowering, the published Rust SDK is not a generated Cargo package, and the only Wasm SDK is a wasm-bindgen guest rather than Hologram Core-Wasm v1. |
| 5. Facet packages | Complete | `prism.arch`, `prism.sec`, and `prism.qual` remain required and must continue passing unchanged unless an explicitly registered application/Holo term is added. |
| 6. Formal model | Incomplete for the new completion boundary | The current `Foundation.Holo` defines flattened indexes and bounds validators, not a Hologram application, archive, layer, capability, identity, encoding, or guest contract. Application packaging semantics are absent. |
| 7. Holo | Incorrect for interoperability | Every emitted `model.holo` begins with JSON (`{"archit...`), while Hologram Live requires the `HOLO` header and physical version 4. The Rust DTO/JSON Schema is a competing format and cannot remain the `.holo` authority. |
| 8. Controller and CLI | Complete only for the obsolete JSON artifact | Existing load/check/build/verify behavior passes, but it cannot build, validate, or report identities for a Hologram application archive. It must be migrated without regressing path, limit, atomicity, or diagnostic guarantees. |
| 9. Standard library | Incomplete | The current cross-facet sample is verified, but `prism-stdlib` lacks the application foundation/runtime role equivalent to libc/libgcc and does not define or consume the real `.holo` contract. |
| 10. Fixtures and goldens | Complete for the historical contract; replacement/addition required | The 16 fixture and 41-file golden suites pass. Holo JSON goldens must become Prism-model/provenance goldens, and new Hologram archive, runtime, Calculator, and browser fixtures are required. |
| 11. Verification | Complete for old normalized validators; extension required | The 597-case execution evidence passes. It does not cover a Hologram guest Wasm module, Holo archive verification/execution, generated Cargo consumption, or browser behavior. |
| 12. Acceptance and release | Incomplete | A clean-evidence `just vv` passes all 14 gates and reproduces 29 build plus 8 verification artifacts. A second run fails `RP-12` because stale valid `target/vv-evidence.json` makes the negative conformance test's `expect_err` fail. The gate is not idempotent. The new ecosystem definition of done is also unmet. |

## Fixed architecture and terminology

These decisions are normative for all tasks below.

1. **Authoring authority.** A Prism application and all Prism-owned theorems,
   validators, behavior, application metadata, and packaging intent are
   authored in `.lex.tex`. LexLean is the only route to Lean. No handwritten
   Prism `.lean` source, application-specific Lean wrapper/exporter,
   Calculator algorithm, or second application model is allowed. Generic
   compiler implementation changes inside LexLean or `lean4-prod` are allowed
   only when registered and may not encode Prism application or Calculator
   domain semantics; a lean4-prod target may implement the registered generic
   Hologram ABI, but not an application model or its behavior.
2. **Holo ownership.** `prism-stdlib`, authored in `.lex.tex`, defines the
   Prism Holo/1 types, validity rules, canonical ordering, physical encoding
   relation, application and portable View projection, Core-Wasm/intent
   contracts, and Prism provenance extension. PrismPM evaluates/uses that
   definition. Handwritten PrismPM Rust DTOs or JSON Schema must not be an
   independent Holo authority.
3. **External interoperability contract.** The first Calculator baseline is
   pinned to Hologram Live commit
   `d8208266d8abdc2445b7bbc0cef412a566adfaf1` and its `uor-hologram` dependency
   commit `2bda6a9a9476872dade705bd61ece4209607f6da`. It uses physical `.holo`
   version 4, source-manifest version 4 where a source manifest is emitted, the
   application-directory extension
   `https://hologram.foundation/extension/application-directory/v1`, canonical
   capability sets, and guest contract `hologram:guest/core-wasm@1`. Updating
   either pin is a reviewed contract change, not an incidental dependency
   refresh.
4. **One `.holo` meaning.** A file named `*.holo` is a binary Hologram v4
   archive beginning with `HOLO`. The old canonical JSON may survive only as a
   renamed canonical Prism model document named `model.prism.json` with schema
   `prismpm/model-document/1`. `model.holo` may not remain JSON.
5. **Version policy.** The Prism format remains Holo/1 throughout this plan.
   Holo/1 is the Prism profile/version and maps to the pinned upstream physical
   archive version 4; the two version numbers are different namespaces.
   Correcting the pre-release Holo/1 definition in place does not create
   Holo/2. Holo/1 freezes only when Calculator, its crate, its executable
   archive, and `calculator-example` all meet the final acceptance gate. Any
   incompatible change after that freeze requires the next Holo version.
   Cargo package SemVer is independent: the first generated `prism-stdlib`
   and `prism-calculator` crates are version `0.1.0`; publishing either version
   does not rename or increment Holo/1.
6. **Authority at runtime.** The Prism model is authoring authority. Its
   generated canonical `AppManifest` is execution topology and Hologram
   application-identity truth. The application directory is derived inspection
   data. A capability object is only an application request; the Hologram host
   grant remains the permission authority.
7. **Identity vocabulary.** Evidence must keep distinct: LexLean source,
   semantic, compiler-semantics, snapshot, and build IDs; Prism model, View,
   and build IDs; generated Lean/LCNF/Rust/Wasm/View/browser hashes; Hologram
   layer content kappa, application kappa, archive footer fingerprint, and
   archive object kappa; Prism attestation ID; and Cargo
   package/version/checksum. No field may silently reuse another identity.
8. **Prism extension.** A fat application archive contains a producer extension
   named `https://uor.foundation/extension/prismpm-model/v1`. Its canonical
   `prismpm/model-provenance/1` value identifies the authoritative model,
   generator inputs, pre-archive Lean/LCNF/generated-core evidence, generated
   executable, Cargo package bytes, and application kappa. The value contains
   the content kappa of exactly one canonical Prism model document stored once
   as an ordinary embedded `ContentBlob`; the Holo/1 Prism validator requires
   that blob to exist and match, even though generic upstream readers treat an
   unknown producer extension as opaque. The value must not contain the final
   Prism attestation ID, archive fingerprint, or archive kappa: those are
   computed after the extension is encoded and would create a digest cycle.
   The external final attestation binds the completed extension and archive.
   Extensions do not grant capabilities and do not replace `AppManifest`.
   The closed payload fields are `schema`, `model_content_kappa`, `model_id`,
   `source_id`, `semantic_id`, `compiler_semantics_id`, `snapshot_id`,
   `stdlib_semantics_id`, `prism_stdlib_crate_sha256`, `lexlean_commit`,
   `lexlean_package_sha256`, `lean4_prod_commit`, `hologram_live_commit`,
   `uor_hologram_commit`, `target_profile_id`, `core_wasm_contract`,
   `lean_manifest_sha256`, `lcnf_manifest_sha256`, `generated_core_sha256`,
   `cargo_name`, `cargo_version`, `cargo_crate_sha256`,
   `guest_content_kappa`, `view_binding`, and `application_kappa`; every field
   is required, unknown fields are rejected, and every digest carries a fixed
   algorithm/length in the V1 type rather than an untyped string.
   `view_binding` is a closed tagged value: `none`, or `present` with required
   `view_model_id`, `view_content_kappa`, and a closed `browser_projection`
   value that is either `none` or `present` with `sha256`; Calculator must use
   View `present` and browser projection `present`.
9. **Cryptographic trust boundary.** `prism-stdlib` defines which exact bytes
   are hashed and where every digest is used. BLAKE3 and SHA-256 compression
   implementations are pinned runtime primitives with published test vectors;
   this release does not claim a Lean proof of collision resistance or a
   formal proof of the Rust cryptographic implementation. All Prism-authored
   functional theorems still require empty observed axiom sets. The generated
   stdlib emits typed, ordered hash-request rounds containing each role and
   preimage: leaf content/capability/model objects first, the canonical manifest
   and application identity after those addresses exist, and final physical
   footer/archive identities only after extension and section bytes exist. A
   narrowly registered crypto adapter returns fixed-width digests for each
   round; generated stdlib code checks and consumes them before producing the
   next round. The upstream oracle independently recomputes every address and
   footer. The adapter may not choose preimages, labels, ordering, dependencies,
   round transitions, or identity roles.
10. **Offline and reproducible builds.** Dependency acquisition may occur only
    in an explicit fetch/setup phase. Check, build, verify, test, package, and
    release acceptance run locked and offline after that phase. Absolute paths,
    clocks, random values, host names, and environment-specific data do not
    enter platform-independent artifacts.
11. **Release versions.** The completed PrismPM line is tagged `v0.2.0`, the
    public LexLean semantic extension is packaged as `0.2.0` and tagged
    `v0.2.0`, generated
    `prism-stdlib` and `prism-calculator` begin at `0.1.0`, and
    `calculator-example` begins at `v0.1.0`. `lean4-prod` is consumed by exact
    commit because it has no ecosystem release contract here. These software
    versions do not change the Holo/1 profile name.
12. **First reference implementation.**
    `github.com/UOR-Foundation/calculator-example` is not an auxiliary demo.
    It is the first reference implementation of PrismPM and of a Prism
    application model. The authoritative Calculator model is one
    content-addressed `.lex.tex` root plus its complete locked source closure,
    stored in PrismPM's getting-started example and mirrored in the reference
    repository; byte equality and the LexLean source/model IDs establish that
    it is one model, not two editable authorities. A change to either copy that
    changes its source ID must update both repositories and regenerate every
    derived artifact. The reference
    repository must run PrismPM itself to check, build, and verify that model;
    merely importing a prebuilt crate or copying a web bundle is insufficient.
13. **Modeled views.** Calculator's UI structure, labels, input grammar,
    operations, action bindings, results, error presentation, accessibility
    semantics, and packaging are typed values in the Prism model. A generic,
    versioned stdlib renderer may project that one value to a Hologram portable
    View and to a GitHub Pages browser adapter. Handwritten HTML, JavaScript,
    TypeScript, Rust UI behavior, or alternate UI state machine may not supply
    application semantics. Target adapters may differ only at the modeled
    transport boundary and must be bound to the same model/view/core IDs.

## PrismPM application acceptance contract

A project qualifies as a PrismPM application only when all of the following
hold. These are product requirements, not optional release checks.

1. It has one closed, authoritative `.lex.tex` application root and dependency
   lock. The root defines its public behavior, typed state and errors, codecs,
   capabilities, ordered Hologram layers, primary, View when present, package
   metadata, and every application-specific acceptance vector. Configuration
   files and generated assets are projections, never a second authority.
2. LexLean produces the canonical semantic snapshot and Lean only from that
   source. Generated Lean elaborates on the pinned toolchain, all declared
   proofs replay through `leanchecker`, and the observed axiom set exactly
   matches the registered policy. Handwritten application Lean is rejected.
3. The named application roots export through the pinned lean4-prod revision.
   LCNF coverage is complete and contains no opaque, unsupported, external, or
   unresolved application behavior. Generated Rust, Cargo, Core-Wasm, View,
   and browser artifacts contain no duplicated application logic.
4. `prismpm check` is non-writing and validates the model through generated
   `prism-stdlib` semantics. `prismpm build` produces the complete declared
   artifact set atomically. `prismpm verify` independently rechecks source,
   generated evidence, package contents, `.holo`, identities, and exact file
   closure without trusting a prior success marker.
5. Every application emits a strict binary Hologram v4 fat archive whose
   manifest, capabilities, layers, content, application directory, Prism
   extension, and identities are the total Holo/1 projection of the model.
   The generated stdlib validator and the pinned upstream reader agree. Each
   declared executable or View surface is planned and exercised through the
   upstream runtime appropriate to that surface.
6. Every declared Cargo package packages successfully, is consumable through a
   registry-format source with no path/Git/source replacement, and agrees with
   the Hologram guest over the model's complete acceptance corpus. A reference
   release must additionally be publicly downloadable at its declared exact
   name/version/checksum.
7. Every declared presentation target is generated from the typed View model,
   exercises only generated public application interfaces, and passes its
   modeled interaction, error, keyboard, focus, and accessibility vectors.
   Host glue may serve immutable bytes and provide the registered transport;
   it may not implement or override application behavior.
8. Two clean absolute roots reproduce every platform-independent source,
   package, Wasm, View, archive, documentation, and evidence byte. After the
   explicit fetch phase, all build and acceptance commands run locked and
   offline in the devcontainer. Tamper, malformed-input, limit, race, symlink,
   partial-publication, stale-evidence, and planted semantic-defect tests fail
   at named diagnostics without panic or successful partial output.
9. A release attestation binds the source/model/compiler/stdlib identities,
   generated Lean and LCNF evidence, package and target hashes, Hologram
   identities, acceptance results, and public locations. All required CI and
   local gates pass on the exact clean commits and downloaded release bytes.

Calculator and `calculator-example` must pass this contract as the first
reference application. Passing only the Calculator arithmetic tests, only the
Cargo package, only `Calculator.holo`, or only the Pages GUI cannot satisfy it.

## Calculator product contract

The getting-started application is deliberately small but completely specified
so its tests cannot choose behavior implicitly.

- Its product name is `Calculator`; its Rust package name is
  `prism-calculator`, initially published as version `0.1.0`; it consumes the
  generated, published `prism-stdlib = "=0.1.0"` crate; its example repository
  is `github.com/UOR-Foundation/calculator-example`.
- It is a stateless signed 64-bit integer calculator with operations Add,
  Subtract, Multiply, and Divide. Arithmetic is checked. Division truncates
  toward zero. Division by zero and every overflow, including
  `i64::MIN / -1`, are typed errors. Floating point, implicit wrapping,
  saturation, and host-language exception behavior are not part of v1.
- The public Rust API exposes `Operation`, `CalculatorError`, and
  `calculate(operation, left, right) -> Result<i64, CalculatorError>`. Its
  `Operation` is generated as `#[repr(u8)]` with variants/discriminants exactly
  `Add = 0`, `Subtract = 1`, `Multiply = 2`, and `Divide = 3`;
  `CalculatorError` has exactly
  `DivisionByZero` and `Overflow`. Wire decoding faults are not calculation
  errors and remain private to the generated dispatcher/codec. Names, result
  semantics, documentation, and examples are generated from the Prism model;
  generated package scaffolding may contain no handwritten arithmetic.
- The Core-Wasm request and response are strict UTF-8/ASCII so the same primary
  is callable through Hologram portable View intent v1. A valid request is
  exactly `1<TAB>operation<TAB>left<TAB>right`, with no newline or surrounding
  whitespace. `operation` is exactly `add`, `subtract`, `multiply`, or
  `divide`; operands are canonical signed `i64` decimal strings with no `+` or
  leading zeroes except `0`. A success is exactly
  `1<TAB>ok<TAB>canonical-result`. An application error is exactly
  `1<TAB>error<TAB>division-by-zero` or
  `1<TAB>error<TAB>overflow`; protocol failures use `malformed-request`,
  `unsupported-version`, or `unknown-operation`. Parsing precedence is exact
  four-field ASCII framing, version, operation, canonical operand syntax and
  range, then arithmetic. Response decoders require exactly three fields and
  reject unknown versions, statuses, errors, noncanonical values, or trailing
  bytes. Valid requests are at most 52 bytes and valid responses at most 27
  bytes. Any malformed request of at most the guest's 65,536-byte allocation
  cap returns the canonical malformed response; a negative, larger, or
  impossible allocation is an ABI resource violation and traps. Only an ABI
  violation or guest failure traps.
- `Calculator.holo` is one self-contained composed fat application. Layer 0 is
  the primary Wasm layer with entry `holo_run` and contract
  `hologram:guest/core-wasm@1`; layer 1 is a non-exit-bearing View layer with
  surface `portable`. Its content is canonical `HOLOVIEW` bundle version 1,
  entry `index.html`, and exactly the lexically ordered generated Calculator
  assets `app.css`, `app.js`, and `index.html`.
  The View posts only same-origin JSON intent
  `{"version":1,"name":"application.invoke","payload":"<request>"}` to
  `/_hologram/intent` and accepts exactly
  `{"version":1,"outputs":["<response>"]}` with one UTF-8 output containing
  the response above. The archive has the canonical empty capability request,
  no child applications, one `AppManifest`, one Metadata section containing the
  generated source manifest, exactly four content blobs (guest Wasm, View
  bundle, canonical empty capability object, and canonical Prism model
  document), exactly the application-directory and Prism producer extensions,
  and one valid footer. Duplicate or extra sections fail the Calculator
  profile.
- The GUI document title and visible heading are `Calculator`. It contains
  signed-integer left and right inputs, an operation selector initially set to
  Add, a Calculate button, a result/error region, labels, keyboard operation,
  and accessible status announcements. Inputs trim leading/trailing ASCII
  whitespace, then accept only an optional `+`/`-` followed by one or more
  ASCII decimal digits whose value is in the `i64` range; empty values,
  separators, decimal points, exponents, and non-decimal forms are UI input
  errors and do not invoke `calculate`. Successful results render as canonical
  base-10 integers with no leading `+` or zeroes (except `0`); the stable user
  messages are `Enter a signed 64-bit integer.`, `Division by zero.`, and
  `Arithmetic overflow.`. Enter activates Calculate, focus remains usable, and
  each result or error replaces the prior live-region contents. These elements,
  transitions, strings, accessibility properties, and action bindings are the
  typed Calculator View value in `.lex.tex`. Generic generators produce both
  the Hologram View-intent frontend and the Pages wasm-bindgen frontend. The
  former invokes the modeled primary; the latter calls the imported
  `prism-calculator` crate. Neither target contains handwritten application or
  presentation behavior.

At audit time, the crates.io API reported that neither exact crate name exists,
and GitHub reported that `UOR-Foundation/calculator-example` does not exist.
That observation reserves no namespace and grants no publication permission;
Task 1 must recheck both under the authorized publisher identity.

## Task 1 — Repair the contract and the acceptance baseline

**Repositories:** PrismPM, with dependency rows for LexLean, `lean4-prod`,
Hologram Live, and `uor-hologram`.

1. Rewrite `SPEC.md`, `README.md`, `CONFORMANCE.md`, `ERRORS.md`, feature
   scenarios, IDs, standards/dependency/authority registers, schemas, and
   artifact-kind registries to incorporate every fixed decision, the PrismPM
   application acceptance contract, and the exact Calculator contract above.
   Mark `v0.1.0` explicitly as a historical prototype and remove every claim
   that PrismPM is complete before the atomic final definition of done. Remove
   claims that `.holo` is JSON or that `lean4-prod` does not participate in
   application production.
2. Rename/redefine the old `prismpm/holo/1` JSON artifact as
   `prismpm/model-document/1`, emitted as `model.prism.json`. Migrate its
   schema to `schemas/model-document.schema.json`, consumers, and diagnostics
   explicitly; remove `schemas/holo.schema.json`; reject legacy JSON supplied
   as `.holo`. Do not add `holo/2`.
3. Register all new diagnostics before constructing them: Holo header/version,
   section/directory/manifest/capability/extension/identity disagreement;
   stdlib-runtime and generated-code mismatch; guest ABI/import/export/memory
   failure; View bundle/model/projection/intent/surface disagreement;
   reference-model identity drift; package/archive/browser publication
   failure; incomplete application acceptance; and upstream oracle
   disagreement.
4. Fix `RP-12` so `just vv` is non-mutating with respect to source and
   idempotent with respect to ignored evidence. At gate start, invalidate or
   isolate prior evidence; the negative release test must create its own
   untagged/dirty/missing-evidence fixture instead of assuming the real root is
   ineligible. Add a test that runs `just vv` twice in one checkout.
5. Preserve and rerun every unaffected historical conformance case. Removal or
   weakening of an old guarantee requires an explicit replacement row and a
   falsifying fixture.
6. Before implementation depends on external names, verify that the approved
   publisher controls or can create the crates.io names `prism-stdlib` and
   `prism-calculator`, and that the authorized GitHub identity can create
   `UOR-Foundation/calculator-example` and configure its Pages environment.
   Record the identity/namespace check without recording credentials. A name
   conflict or missing organization permission is a blocking release
   diagnostic and may not be handled by silently renaming an artifact.

**Evidence:** Generated documents are current and bijective with tests;
`rg` finds no statement that a JSON value is a `.holo`; a JSON-leading
`model.holo` is rejected; the old release commit still passes its preserved
contract tests; and two consecutive devcontainer `just vv` runs pass without
manual cleanup.

## Task 2 — Extend LexLean for portable application and binary definitions

**Repository:** LexLean.

**Dependencies:** Task 1's closed types, semantics, diagnostics, and artifact
contracts.

1. Follow LexLean's register → scenario → failing named test → normative spec →
   implementation order. Extend the fixed semantic language generically; do
   not add Prism-, Holo-, or Calculator-specific IR variants, project-loaded
   grammar, raw Lean, raw Rust, macros, or tactic/code escape hatches.
2. Add closed semantic types and literals for mathematical signed `Int`,
   fixed-width `Int8`, `Int16`, `Int32`, `Int64`, `UInt8`, `UInt16`, `UInt32`,
   and `UInt64`, UTF-8 `String`, and byte sequences. Preserve existing `Nat`,
   `Bool`, `Unit`, `List`, named, structure, inductive, and class forms. `Int`
   remains unbounded and is never silently represented as a fixed-width host
   integer. Fixed-width values are distinct types; conversions and arithmetic
   are checked, with no implicit wrapping or saturation. Bounds and invalid
   UTF-8 are checked before either backend runs.
3. Add generic typed terms required by the stdlib: subtraction,
   multiplication, quotient/remainder with an explicit zero case, negation,
   checked fixed-width conversions and arithmetic, bitwise and/or/xor/not,
   bounded shifts, list/byte append, length, indexed access returning `Option`,
   slicing with explicit failure, UTF-8 encode/decode, and deterministic
   lexicographic byte comparison. Add bounded exact-delimiter split/join and
   canonical base-10 parse/format for every fixed-width integer, including
   explicit syntax, range, and noncanonical-input failures; these are generic
   string/integer operations, not a Calculator protocol primitive. Every term
   has one canonical semantic JSON representation, Lean lowering, LaTeX
   rendering, formatter form, and source map.
4. Permit structurally recursive definitions over byte/list values and the
   closed `Option`/`Result` inductives supplied by the stdlib. Type checking,
   termination restrictions, exhaustiveness, and proof forms remain closed and
   backend-independent.
5. Extend `lexlean/semantic-snapshot/1` in place for this pre-freeze language,
   its public owned DTOs, schema, compiler-semantics digest, all-variant fixture,
   resource limits, and source audit. Old legal 1.0/1.1 inputs retain their
   prior meaning and deterministic output.
6. Generate Lean using only fixed Lean 4.32.1 declarations/operations. Add
   positive and negative fixtures for every new type, literal, operation,
   bound, conversion, UTF-8 case, and recursion shape. Generated theorems and
   proofs must elaborate, replay through `leanchecker`, and report exact empty
   observed axiom sets where policy is empty.
7. Publish an immutable LexLean `v0.2.0` integration revision and `0.2.0`
   packaged crate; record the tag/commit, crate checksum, generated schema
   hashes, and compiler-semantics ID in PrismPM. Update PrismPM's vendored copy
   only from that clean revision.

**Evidence:** LexLean `just vv` passes in its devcontainer; two roots reproduce
all new snapshot/Lean/LaTeX bytes; a downstream crate consumes every new public
snapshot variant; malformed numeric/byte/string values fail before rendering;
and no existing golden changes except reviewed additions or changes forced by
the declared pre-freeze semantic extension.

## Task 3 — Extend `lean4-prod` for Calculator crates and Hologram guests

**Repository:** `afflom/lean4-prod`, contributed upstream through the existing
fork workflow when the change belongs to `auser/lean4-prod`.

**Dependencies:** Task 2.

1. Publish the already verified upstream synchronization before adding new
   work. The local `388f586` merge joins `afflom/main` `f536729` to the
   accepted, edited/squashed PR #23 commit `80634f2` without changing the
   accepted tree; its ancestor/diff checks and devcontainer `just ci` pass.
   Fetch both remotes again immediately before publication. If their refs are
   unchanged, push `388f586` normally to `afflom/main` and verify the remote
   commit and ancestry. If either ref moved, inspect the new commits and update
   the dependency register instead of blindly merging. Do not cherry-pick or
   rebase the old PR commits and do not force-push.
2. Extend named-root LCNF coverage and Rust lowering for the exact new LexLean
   types and operations. Preserve mathematical `Int` semantics: either lower
   it to a semantics-preserving representation where the target profile admits
   one or reject a runtime closure that requires it; never map arbitrary `Int`
   to `i64`. Lower `Int64` to Rust `i64` and implement its generated checked
   operations with the same typed success, division-by-zero, and overflow
   cases proved in Lean. Retain hard errors for unsupported/opaque/external
   calls. Add real LexLean-generated fixtures rather than hand-authored IR-only
   evidence.
3. Add a deterministic generated Cargo-library target. It emits a complete
   publishable package tree (`Cargo.toml`, generated `src/lib.rs`, README,
   licenses, metadata, and manifest of input/output hashes), supports `no_std`
   where its selected closure permits it, and never requires a handwritten
   wrapper around generated functions. `cargo package --locked` and an offline
   downstream dependency must succeed.
4. Add a distinct Hologram Core-Wasm v1 target; do not reuse the wasm-bindgen
   SDK. It emits a `wasm32-unknown-unknown` module with no imports or WASI,
   exported `memory`, `holo_alloc(i32) -> i32`, and the selected
   `(i32, i32) -> i64` entry. Every pointer/length is a non-negative `i32`;
   the return value is exactly `(u64(out_ptr) << 32) | u64(out_len)`. The
   generated adapter uses the stdlib request and response codecs and contains
   no Calculator behavior.
5. Use a bounded, monotonically increasing, at-least-8-byte-aligned guest bump
   allocator reset by each fresh Wasm instantiation; it has no deallocator.
   A zero-byte allocation returns an in-bounds aligned pointer, while negative,
   overflowing, over-limit, or impossible-to-grow requests trap as ABI failures.
   Input and output allocations do not overlap, returned output remains
   immutable and readable until that fresh instance is dropped, and the host
   copies it before dropping the instance. Compile with abort-on-panic/no
   unwinding. Test memory growth/page caps, packed pointer/length results, and
   direct and resident fresh-instance behavior. Calculator's valid canonical
   request is at most 52 bytes, its guest allocation cap is 65,536 input
   bytes, and every canonical response is at most 27 bytes; generic target
   limits and maximum pages are explicit generated-manifest values.
6. Add a generic target for exported `Foundation.View.V1` values. It renders
   the typed tree, styles, validation, actions, accessibility semantics, and
   transport binding into deterministic escaped assets without project-name or
   Calculator branches and rejects any unmodeled/raw web content. The Hologram
   projection emits a canonical portable View bundle whose only invocation
   path is intent v1 to the modeled primary. Retain the browser wasm-bindgen
   target for `calculator-example`, but make it emit a separate generated
   adapter package and Pages asset projection that depend on the generated
   Cargo core by exact package name/version and call only its public API;
   release output uses a registry dependency, never copied core source or a
   path override. Browser and Hologram adapters may have different transport
   bytes; evidence binds both and their View assets to one
   model/LCNF/generated-core/View identity. The generated TypeScript boundary is
   `calculate(operation, leftDecimal, rightDecimal)`, where operation is
   `0|1|2|3`, operands are strings in the fixed GUI grammar, and the result is
   `{kind:"ok", value:string}` or
   `{kind:"error", error:"division-by-zero"|"overflow"}`. The adapter parses
   to Rust `i64`, returns canonical decimal text, and rejects direct invalid
   calls; JavaScript `Number` is never used for an operand or result. All DOM
   construction, events, messages, focus, live-region updates, and styling are
   generated from the View value rather than handwritten in the reference
   repository.
7. Add Wasm inspection tests proving the exact exports/signatures and an empty
   import table, Wasmtime execution tests for all Calculator result classes,
   malformed input tests, deterministic two-root Wasm/package reproduction,
   and existing optimized/debug/no-allocation/SDK/CI gates.
8. Commit and push the fork revision. If upstream modification is required,
   open an issue in `auser/lean4-prod` explaining the generic capability and a
   PR from `afflom/lean4-prod:main` to `auser/lean4-prod:main` whose body uses
   `Closes #<issue>`; record both URLs and CI result. PrismPM pins the exact
   accepted fork commit and package hashes rather than waiting on a branch tip
   or merge. The contribution branch and PR must descend from the synchronized
   `80634f2` ancestry; the already accepted PR #23 changes must not appear as
   new patch content.

**Evidence:** the synchronized baseline has `80634f2` as an ancestor, preserves
its tree byte-for-byte before new work, and passes `just ci` in the lean4-prod
devcontainer; the completed extension also passes `just ci`; generated
Calculator Rust has no handwritten source; its crate packages and compiles
offline; `wasm-tools`/Wasmtime and Hologram Live accept the guest; the guest has
zero imports and the exact ABI; planted import, wrong signature, allocator,
unchecked-overflow, and wrapper-logic defects fail named gates.

## Task 4 — Make `prism-stdlib` the Holo/1 and application foundation

**Repository:** PrismPM `stdlib/`, authored exclusively in `.lex.tex`; generated
runtime/package artifacts are derived outputs.

**Dependencies:** Tasks 1–3.

1. Define a versioned module family for the first portable foundation layer:
   `Foundation.Core`, `Foundation.Integer`, `Foundation.Bytes`,
   `Foundation.Utf8`, `Foundation.Result`, `Foundation.Codec`,
   `Foundation.Runtime`, `Foundation.Application`, and the
   `Foundation.View.V1.Model`, `.Interaction`, and `.Projection` family. This
   is the v1 libc/libgcc-equivalent **ecosystem role**, not a POSIX or C ABI
   clone.
2. Its required v1 surface is closed: Boolean/unit/order; option/result and
   closed error values; fixed-width signed/unsigned values and checked
   arithmetic/conversion; byte/list/bounded-buffer construction, comparison,
   slicing, and little-endian codecs; UTF-8 validation/encoding; deterministic
   structural recursion; guest memory/allocator abstractions; typed ordered
   View trees, form controls, validation/action/result bindings, focus and
   live-region semantics, closed style tokens and target transports; and the
   BLAKE3 and SHA-256 primitive contracts. Files, sockets, processes, clocks,
   locale, environment, nondeterministic randomness, threads, dynamic loading,
   floating point, and POSIX APIs are explicitly outside this first baseline
   and may enter only through later capability-scoped work.
3. Replace the current `Foundation.Holo` implementation with the exact module
   family `Foundation.Holo.V1.Format`, `.Identity`, `.Capability`, `.Manifest`,
   `.Directory`, `.Archive`, `.CoreWasm`, `.View`, `.PrismExtension`, and
   `.SourceManifest`, plus a `Foundation.Holo` facade that selects V1. Together
   they define header/version/flags, section kinds and section table,
   `AppManifest`, closed layer kinds, content blobs, metadata, extensions,
   application directory, capability requests and child delegation, footer,
   physical archive, Core-Wasm v1 layer/entry/ABI, generated source manifest,
   portable View surface, and the three Hologram identities. The View contract
   includes `HOLOVIEW` magic, big-endian bundle version 1, `index.html` entry,
   lexically ordered portable asset paths, `u32` path/count fields, `u64` asset
   lengths, no trailing bytes, and the pinned upstream limits: 4,096 files,
   1,024 bytes per path, 64 MiB per file, and 256 MiB aggregate content. It
   rejects symlinks, special files, invalid UTF-8/non-portable or reserved path
   components, case-folded collisions, duplicates, missing entry, wrong order,
   unsupported surface/version, truncation, and overflow. Define canonical
   ordering, uniqueness, bounds, cross-references, address inputs, fat-archive
   completeness, and strict rejection predicates.
4. Define the Prism application vocabulary: application name, generated entry
   root, typed request/response codecs, required capabilities, ordered layers,
   primary layer, children/delegations, typed View model and actions, fat/thin
   packaging intent, and the total projection to a Holo application. The first
   View vocabulary is deliberately closed to the Calculator reference needs:
   document metadata; ordered landmarks/text/form controls; input grammar and
   validation messages; select options; submit/Enter actions; typed result and
   error mappings; focus retention; polite/assertive live output; and closed
   layout/color/typography tokens. It admits no raw HTML, script, CSS, DOM
   callback, URL, or host command. Define deterministic escaping and projection
   from that value to canonical Hologram intent assets and Pages wasm-bindgen
   assets, with target-specific transport as the only difference. An
   application model, not `prismpm.toml`, handwritten Rust, or handwritten web
   content, chooses these semantics.
5. Define canonical byte encoders/decoders and independent validity predicates
   for the physical Holo/1 projection. State and prove round-trip, canonical
   uniqueness, index/reference, directory-derivation, empty-capability, and
   projection soundness results within the expressiveness of the closed
   language. Model the staged typed hash-request/result protocol and its legal
   phase transitions so every BLAKE3 or SHA-256 preimage is fixed before the
   registered adapter runs, and reject missing, extra, reordered, stale-round,
   wrong-length, dependency-invalid, or role-mismatched results. Do not claim
   cryptographic collision resistance or equivalence of an unproved external
   hash implementation.
6. Define the exact Prism extension and canonical
   `prismpm/model-provenance/1` payload. Prove/validate that it cannot alter the
   application manifest, grant authority, or conceal a manifest/blob/directory
   mismatch.
7. Replace the handwritten Rust Holo projector/DTO authority with a generated
   `prism-stdlib` runtime crate or generated schema/codec tables consumed by a
   generic PrismPM adapter. The committed generation manifest binds every line
   to `.lex.tex`, LexLean, generated Lean, LCNF, and lean4-prod. A source audit
   rejects handwritten copies of Holo/View enums, tags, layouts, renderings,
   state transitions, and validation rules outside narrowly registered
   I/O/crypto/host-transport adapters.
   The generated Cargo package is named `prism-stdlib`, initially versioned
   `0.1.0`, and packages with no path or Git dependencies. Its public symbols
   are exactly declarations marked public in `.lex.tex`, under a deterministic
   documented Lean-to-Rust naming map; helpers remain private and adapters are
   exposed only through the registered request/result boundary. Its only Cargo
   feature is default `std`; `--no-default-features` is the Core-Wasm/no-std
   surface and may not remove or replace semantic behavior. Native, no-std,
   Core-Wasm, and downstream consumption tests cover both selections. Package
   metadata uses `MIT OR Apache-2.0` and includes both license texts.
8. Resolve bootstrapping explicitly: build the stdlib runtime from the pinned
   LexLean/lean4-prod tools, build PrismPM against that generated runtime, then
   regenerate it with the resulting PrismPM and require a byte-identical fixed
   point. `check` never requires a compiler child process after this generated
   runtime is part of the PrismPM binary/package.
9. Add a stdlib conformance application that uses the foundation/runtime APIs,
   emits a real fat `.holo`, passes upstream inspection/planning/execution, and
   demonstrates that `prism-stdlib` both defines and uses Holo. Preserve the
   existing architecture/security/quality model, cycle acceptance, validators,
   theorems, and empty-axiom evidence.

**Evidence:** Only `.lex.tex` is authoritative stdlib source; generated Lean
elaborates/replays with the registered axiom policy; generated Rust compiles
for native and wasm32; checked arithmetic/codec/UTF-8/buffer negative vectors
pass; encoder bytes agree with the pinned `uor-hologram` oracle; the stdlib
View model rejects raw/unmodeled content and its bundle bytes agree with the
pinned Hologram `HOLOVIEW` encoder; the stdlib fixed-point rebuild is
byte-identical; and Hologram Live verifies and runs the stdlib conformance
archive.

## Task 5 — Migrate PrismPM to real application builds and `.holo` archives

**Repository:** PrismPM.

**Dependencies:** Task 4.

1. Preserve `Controller::load` and the no-write semantic `check` path, but make
   it validate application declarations through generated stdlib types and
   validators. No handwritten Rust projection may reinterpret the model.
2. Define explicit phases for `build`: LexLean snapshot/build; Lean
   elaboration/replay/axiom audit; named-root export; LCNF validation; generated
   Cargo core; Hologram guest Wasm; typed View evaluation; deterministic
   Hologram and browser View projection; application manifest/capability/
   directory/extension creation; portable View bundle and physical archive
   encoding; independent Hologram verification; application-acceptance report;
   and atomic publication. Network is forbidden in these phases.
3. Expose each phase through stable owned API/CLI result types and registered
   errors without exposing LexLean mutable IR, lean4-prod internal IR, or
   upstream Rust implementation types. Preserve bounded child output/time,
   process-tree termination, path confinement, symlink rejection, and
   deterministic diagnostics.
4. Replace the old build tree with an exact manifest-owned layout containing a
   non-Holo canonical `model.prism.json`, LexLean artifacts, verified Lean
   evidence, LCNF/coverage/roots, generated Cargo package, guest Wasm, canonical
   evaluated View value, Hologram View assets/bundle, browser adapter/assets,
   a generated non-authoritative Hologram source manifest (`hologram.json`),
   `ApplicationName.holo`, Prism extension/provenance, identities, SBOM, and
   build/verification manifests. The source manifest is derived from the
   authoritative application value and is never accepted as a parallel Prism
   source. Its canonical UTF-8 bytes are also the archive's single Metadata
   section, its file references are confined relative paths into the generated
   tree, and those paths never enter Hologram content/application identities.
   Platform-dependent binaries are recorded by normalized identity unless
   declared release artifacts.
5. Compute the build and attestation identities from exact canonical input
   records including the stdlib/Holo semantics, Hologram pins, target profile,
   generated core, Wasm, View model and target projections, manifest,
   capability, extension, application kappa, archive fingerprint, and archive
   kappa. Use two acyclic stages: pre-archive
   compiler evidence is embedded by digest in the Prism extension; after the
   final archive bytes exist, the external Prism attestation binds that
   evidence, extension bytes, fingerprint, and archive kappa. Reuse verifies
   every declared byte and exact file set; tampering, extras, symlinks, or
   partial prior output are errors.
6. Strictly decode/verify external `.holo` archives against Holo/1 and the
   pinned upstream reader. Reject JSON, wrong versions, unknown/duplicate
   sections, malformed canonical objects, incorrect content labels, missing or
   disagreeing directories, unknown guest contracts, noncanonical empty
   capabilities, malformed/noncanonical View bundles, View surface/intent/model
   disagreement, forged Prism provenance, and identity disagreement.
7. Keep publication atomic and race-safe. A failure in compilation, upstream
   verification, packaging, execution, or evidence writing publishes neither a
   successful build nor a verified directory.
8. Make the application acceptance contract a first-class, versioned
   `prismpm/application-acceptance/1` result used by API, CLI, CI, and release
   tooling. It enumerates every required gate and evidence identity; missing,
   skipped, stale, conditional, or unbound evidence is failure. The word
   `complete` may be emitted for an application only from this successful
   result, and PrismPM's own release gate additionally requires successful
   stdlib and Calculator reference-application results.

**Evidence:** API/CLI/diagnostic, no-write, limit, timeout, race, symlink,
tamper, partial-publication, two-root, and offline tests pass; emitted `.holo`
starts with `HOLO\x04\x00`; both the generated stdlib validator and pinned
Hologram loader accept it; all old safe controller behavior remains covered.
The stdlib conformance application and Calculator each produce a complete
`prismpm/application-acceptance/1` result, while a fixture missing any one
required artifact or execution target cannot do so.

## Task 6 — Add the fully Prism-defined `Calculator` getting-started project

**Repository:** the canonical getting-started source under PrismPM
`examples/Calculator/`; Task 8 mirrors the exact content-addressed model into
`calculator-example` and rejects divergence.

**Dependencies:** Task 5.

1. Author the complete Calculator types, operation/error enum, checked
   arithmetic, request/response codec, application definition, entrypoint, and
   correctness theorems in `.lex.tex`. Author its complete typed View tree,
   labels, control options, validation grammar/messages, submit and Enter
   bindings, result/error rendering, focus/live-region behavior, closed style
   values, Hologram intent target, and Pages target in that same model. There
   is no handwritten Calculator Lean, Rust, Wasm text, WAT, C, HTML, CSS,
   JavaScript/TypeScript, UI state machine, arithmetic, or test oracle that
   substitutes for the specified semantics.
2. Prove each successful operation equals the corresponding mathematical
   result when it is in range; prove division/error conditions; prove request
   and response codec round trips for valid values; prove the dispatcher agrees
   with `calculate`; and prove every admitted View action maps to exactly one
   typed calculation/request and every result/error maps to the specified View
   state. Every generated theorem uses the explicit empty axiom policy and
   passes elaboration, replay, and exact axiom inspection.
3. Generate a deterministic publishable `prism-calculator` Cargo crate with
   the fixed public API, Rust documentation, getting-started example,
   `MIT OR Apache-2.0` metadata and both license texts,
   repository/homepage metadata, source/provenance manifest, and no hidden
   path/git dependency. Its only Prism runtime dependency is exact
   `prism-stdlib = "=0.1.0"`, and its packaged manifest contains no
   workspace/path override. Before public release, resolve that dependency
   through a deterministic crates.io-format local registry mirror populated
   only with the final `prism-stdlib` release-candidate `.crate`; Task 8 repeats
   verification against the real registry. The package must build/test with
   `--locked --offline` and from a crates.io-style unpacked package tree. Its
   only feature is default `std`, forwarded to `prism-stdlib/std`; building
   with `--no-default-features` is the generated no-std core used by the
   Hologram adapter and must expose the same calculation semantics and public
   types. Also generate a non-published wasm-bindgen adapter package whose
   release manifest depends on exact registry `prism-calculator = "=0.1.0"`,
   whose only code marshals the generated View transport to that public API,
   and whose provenance binds the same model, View, LCNF, and generated-core
   identities. Generate all Hologram and Pages frontend assets from the typed
   View; do not accept an application-owned asset overlay.
4. Generate the Core-Wasm guest and `Calculator.holo` exactly as specified in
   the product contract. Run a corpus covering zero, signs, boundaries, all
   operations, truncating division, divide-by-zero, both overflow directions,
   malformed framing/fields through the 65,536-byte admitted cap, the first
   over-cap trap, bad versions, unknown operations, and noncanonical operands
   through generated Rust, direct Wasmtime, Hologram direct/resident execution,
   and Hologram portable View intent. All paths agree byte-for-byte where a
   domain response is defined and agree on the over-cap failure boundary. Open
   the composed Wasm + View application through Hologram's display-independent
   Desktop surface seam and prove repeated actions, exact response rendering,
   session ownership, reverse detach/stop, and idempotent shutdown.
5. Make the README getting-started path start from a clean checkout and show
   model check, build, verification, archive inspection, headless plan/direct
   primary run, Desktop View run, crate use, reference-repository reproduction,
   and where every generated artifact/evidence item resides. Commands execute
   in the devcontainer and require no handwritten generated-source edits.
6. Rebuild the model, crate, Hologram Wasm, browser adapter package/Wasm,
   archive, documentation, and evidence in two absolute directories. Compare
   every declared platform-independent byte and identity.
7. Stage `Calculator.holo`, its inspection report, checksums, provenance, and
   invocation examples as byte-final PrismPM `v0.2.0` release candidates.
   Task 9 publishes those exact bytes only after registry and Pages identities
   are available for the final manifest. A local ignored build artifact is not
   publication.

**Evidence:** `prismpm check/build/verify` and the complete
`prismpm/application-acceptance/1` gate succeed for Calculator; generated
Lean has empty observed axioms; coverage has no opaque/unsupported/unresolved
rows; `cargo package` and a downstream crate pass offline against the isolated
local registry mirror; Hologram Live verifies/plans/runs `Calculator.holo` and
attaches its generated portable View; the complete arithmetic, protocol, View,
and accessibility corpus agrees across all targets; two-root output is
identical.

## Task 7 — Establish independent Hologram conformance

**Repositories:** PrismPM plus pinned, unmodified checkouts of Hologram Live and
`uor-hologram` inside the devcontainer/tool cache.

**Dependencies:** Task 6.

1. Add an offline-buildable conformance harness pinned by commit and source
   checksum. Upstream crates/tools are an independent oracle and must not share
   Prism's encoder/validator implementation.
2. For stdlib and Calculator archives, run upstream loader/inspection,
   application-directory verification, strict plan creation, and execution.
   For the composed Calculator archive, the ordinary headless CLI plan must
   report the pinned explicit unavailable-`portable`-surface blocker and start
   nothing; a display-independent registered surface must then attach the View
   and execute its intents against the same prepared Wasm primary. Also execute
   the primary in the upstream direct and resident harnesses. Assert the exact
   layers, primary, entry, contract, surface, lifecycle order, capability
   request, content/application/archive identities, footer, Prism extension,
   and outputs—not merely zero exit status.
3. Cross-generate equivalent minimal archives with the stdlib encoder and
   upstream `HoloWriter`; require equality for the canonical common sections
   and explain/test the intentional Prism extension/content additions. Require
   the stdlib View encoder to equal upstream `HOLOVIEW` v1 for asset trees built
   in different filesystem orders. Decode every upstream archive/View golden
   through the stdlib model and every Prism golden through upstream tools.
4. Add mutation tests for every header/table/offset/length/section/footer,
   manifest/layer/child/capability, content kappa, directory, extension,
   guest-contract, import/export, pointer/length, View magic/version/path/
   ordering/size/surface/intent, and resource-limit failure class. Each must
   fail at the registered boundary without panic or partial output.
5. Record normalized upstream command/tool/source identities and outputs in the
   Prism attestation. Do not incorporate checkout paths, elapsed time, or
   nondeterministic Wasmtime data.

**Evidence:** The pinned Hologram Live tests required by the integration pass;
both directions of conformance vectors pass; Calculator executes through
Hologram direct and resident providers with fresh-instance semantics and
through the persistent portable View session; its headless surface blocker is
exact; every mutation is rejected under its named diagnostic; no network is
used after the fetch phase.

## Task 8 — Prepare the `calculator-example` release candidate

**Repository:** create `github.com/UOR-Foundation/calculator-example` only
after Task 6 produces the byte-final crate release candidate.

**Dependencies:** Tasks 6 and 7.

1. Push the clean, fully green PrismPM/LexLean/lean4-prod release-candidate
   commits so every Cargo repository/source/provenance URL resolves to an exact
   public commit; do not create the final tags or GitHub release yet.
2. Put the byte-final `prism-stdlib` and `prism-calculator` `.crate` candidates
   in a fresh deterministic crates.io-format local registry and test the same
   serial publication order that Task 9 will use. Verify package checksums and
   build a fresh Calculator consumer with no path, Git, patch, workspace, or
   source replacement. Clear ordinary Cargo caches for the consumer so only
   the isolated registry supplies the packages. This is a prepublication gate;
   it does not count as public registry publication.
3. Create the public repository with MIT/Apache-2.0 licensing, README,
   devcontainer, locked Rust/Node/browser toolchains, dependency policy,
   security policy, and full-SHA-pinned GitHub Actions. Mirror the exact
   content-addressed Calculator `.lex.tex` model and lock from PrismPM, pin the
   PrismPM release-candidate executable/source identity, and provide one command
   that runs its `check`, `build`, `verify`, and application-acceptance gates.
   CI rejects any source/model ID difference from PrismPM's getting-started
   copy or any byte/identity difference in the generated package, Wasm, View,
   `Calculator.holo`, and evidence closure. The Cargo manifest pins exact
   `prism-calculator = "=0.1.0"` and a checked-in lockfile; until Task 9 publishes
   it, candidate builds resolve those exact bytes only from the isolated
   registry. The Pages build consumes that registry candidate, not the locally
   regenerated crate, so it also proves the declared external dependency.
4. Commit the byte-current generated wasm-bindgen adapter, Pages View assets,
   and provenance, with an acceptance check that regenerates all of them from
   the mirrored model using the pinned PrismPM release candidate. There is no
   handwritten GUI/presentation glue: document structure, text, controls,
   validation, events, state transitions, error mapping, accessibility, styles,
   and crate calls all come from the typed View and generic target. The only
   repository-owned code is generic build/deployment infrastructure that cannot
   name an operation, parse an operand, calculate, mutate View state, or provide
   a fallback. Full-range values remain strings across JavaScript and are
   converted to `i64` only by the generated adapter; no `Number` coercion is
   permitted.
5. Build the byte-final static browser application without deploying it. The
   workflow first reproduces the model IDs and all PrismPM application
   artifacts, then runs formatting, lint, unit, Wasm/browser integration,
   accessibility, dependency, application-acceptance, and production build
   gates and uploads the exact attested production directory. Its separate
   Pages deployment job is
   release-gated and remains disabled until Task 9 authorizes the immutable
   artifact; pull requests never deploy. Two clean absolute roots produce
   identical production files and manifest hashes. Runtime assets are bundled
   and same-origin; there are no CDN, analytics, telemetry, or
   calculation-network fallbacks. The production directory contains exactly
   `index.html`, `app.css`, `app.js`, `prism_calculator.js`,
   `prism_calculator_bg.wasm`, and `provenance.json`; source maps, development
   files, path-dependent names, and undeclared extras fail the file-closure
   gate.
6. Serve and test that exact production directory locally with pinned
   Playwright Chromium for all four operations, negative values, truncating
   division, divide-by-zero, overflow, the complete input grammar, keyboard
   use, focus behavior, labels, and accessible result/error announcements.
   Automated axe-core checks have no WCAG 2.2 A/AA violations. Assert the
   loaded Wasm/package provenance identifies the Calculator release-candidate
   model/View/core/build. Compare the Hologram View and Pages interaction traces
   after normalizing only their registered transport envelopes; modeled actions
   and resulting View states must be identical.
7. Stage a release-record candidate that binds the site commit and production
   directory hash, crate candidate versions/checksums, source model ID,
   generated core and View IDs, complete application-acceptance attestation,
   and Calculator Holo application kappa. The browser Wasm and Hologram Wasm
   may differ only by their generated target adapters and are tied to the same
   generated core and View. Configure the sole permitted Pages URL as
   `https://uor-foundation.github.io/calculator-example/`; configuration and
   tests fail rather than silently target a different base path. Task 9 adds
   the observed deployment identity only after the live site is verified.

**Evidence:** A clean devcontainer checkout builds offline after fetch; the
isolated registry-only dependency test passes; browser tests pass against the
exact staged production directory; two-root output is identical; the public
release-candidate commit reproduces the PrismPM model and passes the complete
PrismPM application acceptance contract; non-deploying Actions gates are green.
No crate, tag, release, or Pages deployment has yet been published by this
task.

## Task 9 — Complete ecosystem acceptance and freeze Holo/1

**Repositories:** LexLean, `lean4-prod`, PrismPM, and `calculator-example`.

**Dependencies:** all previous tasks.

1. Extend each repository's normative acceptance gate and CI to cover its new
   work. Run the complete gates from clean devcontainer checkouts, locked and
   offline after dependency fetch. Run PrismPM `just vv` twice consecutively.
   Both PrismPM's Calculator copy and the reference repository's identical copy
   must independently produce successful, identity-equal
   `prismpm/application-acceptance/1` results.
2. Re-run all historical PrismPM, LexLean, and lean4-prod gates; no skipped,
   ignored, filtered, conditional, network-dependent, or stale-evidence result
   counts as acceptance. Falsify every new gate with a planted representative
   defect and record the failing command/diagnostic and restored commit.
3. Produce reproducible source/package/SBOM/checksum/provenance artifacts for
   the generated `prism-stdlib` runtime package, PrismPM, and
   `prism-calculator`. Audit licenses, advisories, duplicate versions, tool
   executables, GitHub Action SHAs, package contents, secret exclusion, and
   every vendored/pinned source hash.
   Steps 1–3 are the mandatory prepublication gate: any failure stops before
   a Cargo publish, Pages deployment, tag, or GitHub release.
4. Publish generated `prism-stdlib` version `0.1.0` to the Cargo registry under
   the approved account. Verify the registry checksum and a fresh
   registry-only consumer with caches isolated. Repackage and test Calculator
   against those downloaded bytes, require the `prism-calculator` `.crate` to
   be byte-identical to Task 8's candidate, then publish version `0.1.0` and
   verify its downloaded checksum and a fresh consumer. No consumer may use a
   path, Git, patch, workspace, source replacement, or prepublication cache.
   A credential, ownership, checksum, byte-identity, or availability failure
   stops the release and may not be treated as a dry-run success.
5. Rebuild the staged browser application using only the public registry,
   require byte identity with Task 8's attested production directory, and
   authorize the release-gated workflow to deploy that exact directory without
   rebuilding it. Test the live HTTPS application at
   `https://uor-foundation.github.io/calculator-example/` with the complete
   Playwright/axe corpus and verify the served asset hashes, source commit,
   released crate checksum, model/View/core/build identities, Holo application
   kappa, and normalized behavioral equivalence with the Hologram View.
6. Write a final release manifest that binds all repository commits, toolchain
   and dependency pins, Holo/1 semantics ID, stdlib fixed-point identity,
   Calculator source/model/attestation IDs, crate registry checksum, Wasm
   guest and View content kappas, View model and browser
   adapter/package/Wasm hashes, both application-acceptance attestations,
   Hologram application/archive identities, and deployed Pages commit/URL.
7. Tag and publish only clean commits whose exact CI/devcontainer evidence is
   recorded: PrismPM `v0.2.0`, LexLean `v0.2.0`, and `calculator-example`
   `v0.1.0`, with the Cargo packages at the versions fixed above. Publish the
   staged `Calculator.holo`, inspection, checksums, provenance, invocation
   examples, and final release manifest as PrismPM `v0.2.0` GitHub release
   assets, and verify the downloaded asset bytes. Push PrismPM and LexLean to
   their required origins; push lean4-prod to `afflom/lean4-prod` and complete
   the upstream issue/PR flow for generic upstream changes. Push
   `calculator-example` and confirm Pages serves only the step 5 deployment.
8. Freeze Holo/1 only when every final condition below is objectively true.
   Subsequent incompatible Holo work must use the next Holo version and carry
   migration fixtures from this actually shipped baseline.

**Final definition of done:**

- PrismPM's own release gate recognizes completion only when all bullets in
  this definition of done are bound into one final manifest. The historical
  `v0.1.0`, a green PrismPM core, a completed stdlib alone, or either Calculator
  target alone is not a completed PrismPM release.
- `prism-stdlib` supplies the closed first portable foundation/runtime surface
  defined above, formally defines Holo/1 in `.lex.tex`, and builds/runs its own
  real Holo conformance application. Its generated `0.1.0` Cargo package is
  published and independently consumable from the registry.
- PrismPM produces binary, strict Hologram v4 `.holo` archives solely from
  authoritative Prism application models and generated stdlib semantics.
- Calculator, including its typed UI and interaction semantics, is completely
  `.lex.tex`-defined, Lean-verified, exported through
  `auser/lean4-prod`/the accepted fork revision, generated as a publishable
  `prism-calculator` crate and import-free Core-Wasm guest, packaged as a fat
  composed Wasm + portable View `Calculator.holo`, and executed successfully by
  the pinned Hologram Live with its View attached.
- The published Cargo crate is independently downloadable and its behavior
  agrees with the Holo application over the complete fixed corpus.
- `UOR-Foundation/calculator-example` is the published first reference
  implementation of PrismPM and the Prism model. It mirrors the identical
  content-addressed Calculator source, runs PrismPM to reproduce and verify the
  application, imports the registry crate, contains no handwritten or duplicate
  Calculator/UI behavior, passes the complete PrismPM application and
  browser/accessibility acceptance contracts, and serves the generated GUI
  from GitHub Pages.
- All four repository gates and CI pass from clean devcontainers; PrismPM's
  gate passes twice without cleanup; reproducibility and negative-falsification
  evidence is complete; all release commits and artifact identities are
  recorded and pushed.
