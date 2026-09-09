# Calculator verification

`prismpm.lock` binds the executable SDK and its complete inventory. The same
manifest digest is used by the devcontainer and GitHub Actions.

| Boundary | Verification |
| --- | --- |
| accepted baseline | closed SDK schema, historical Git bytes, current regenerated closure, public downloads, live Pages, and immutable command transcripts |
| corrected projection publication | the protected-ref-only, confined pre-seal Pages phase requires absent remediation claims, exact regenerated local bytes, a successful Pages deployment for the exact commit, live HTTPS byte equality, and live browser/accessibility acceptance; ordinary publication requires exact accepted CalculatorSystem release B, a second clean pull/trust replay, and byte equality between its six `view/browser/*` files and `public/` |
| crate publication | protected crates.io trusted publishing uses pinned Cargo only after its package output byte-matches the generated attested archive; registry checksum and downloaded bytes are then independently compared |
| baseline input | the explicit pre-seal command runs every substantive Calculator closure check and emits canonical evidence; it cannot publish or promote |
| baseline seal | five complete transcripts bind the exact clean repository commits, commands/repeats, and one immutable SDK image; adversarial tests reject missing, extra, stale, dirty, failed, noncanonical, or tampered evidence before the one-shot seal |
| conformance result | all 230 unique case identities match the actual OCI coverage artifact; transcript bytes, release, locked SDK, shipped runner, referrer subject/payload bytes, and index discovery are cross-bound; planted wrong-identity, partial, open-shape, stale-coverage, changed-referrer, missing-index, noncanonical, and symlink defects fail |
| source | LexLean snapshot/link and generated Lean proof |
| application | checked i64 corpus, Core-Wasm, Holo/1, Cargo, View, Pages |
| system | typed A/B system manifest and generated standard artifacts |
| standards | pinned upstream OpenAPI, AsyncAPI, CloudEvents, Compose, Kubernetes, OIDC, OpenTelemetry, SPDX, SLSA and OCI oracles |
| supply chain | locked inputs, vulnerability snapshot, SBOM, provenance, validation, SDK-derived Sigstore policy/root, signed candidate/accepted promotion chain, clean GHCR reconstruction, and independent `verify-release` cryptographic replay |
| runtime | generated API/View/worker against PostgreSQL, broker, issuer and Collector through real Compose and TLS Kind ingress |
| lifecycle | plan/apply/status/drift/rollback, measured SLO checks, foreground reverse-dependency shutdown, plus Compose and clean-cluster Kind backup/restore/retirement evidence |
| reproducibility | A, B and Pages rebuilt from two clean absolute roots and Actions |
| public contract | complete SDK-shipped feature/diagnostic execution transcript attached to each exact A/B release; every public row binds its exact register source, generated output, and locked standard-authority IDs or an explicit Prism-owned none reason |
| target release policy | source and projected target rows require `development` for local Compose/Kind and `accepted` for public Pages; planted missing, invalid, and weakened policies fail |
| committed capability projection | `just update-system-projection` accepts only the SDK-generated release-B matrix after full system and strict coverage validation; `just verify-system-projection` rebuilds and byte-compares it |
| runtime image binding | the release renderer parses both authoritative system models, admits only the public runtime index at an exact digest, rejects divergent A/B bindings, and transactionally regenerates the dependent LexLean lock |
| external runtime closure | protected full-system acceptance fetches exact index bytes, verifies their modeled SHA-256/media type, requires linux/amd64 and linux/arm64 descriptors, pulls both platform images through Docker's digest-verifying content store, and removes newly acquired image references |
| cross-platform equivalence | clean amd64/arm64 outputs are inputs to the SDK-owned canonical platform-equivalence comparator; Calculator owns no independent portability exclusions |

The SDK boundary verifies both the canonical path and SHA-256 bytes of every
substantive command used by the repository gate against the immutable image
inventory. A planted PATH-shadowed LexLean executable must be rejected before
any model proof runs, so a host or project tool cannot silently replace the
locked compiler. The same boundary hashes the SDK's embedded source archive
and rejects a missing, extra, symlinked, or byte-modified installed model input;
clean-root reproduction copies that validated manifest and exact input tree.

Workflow policy is independently planted with floating-runner, floating-action,
shallow-history, continue-on-error, unverified-clean-pull,
hidden-release-store, acceptance-bypass, unmodeled-default-target,
overprivileged-deploy, unprotected Pages publication, wrong release status or
system version, regenerated publication, and missing release-byte comparison
defects.
The template updater copies only universal policy, preserves Calculator's
transactional renderer and workflows, and includes the runtime model plus all
dependent locks and generated conformance in its reviewable patch. Planted
renderer-overwrite, runtime-omission, and dependent-lock-omission mutations
fail. Both releases also invoke the published PrismPM SDK reusable workflow;
replacing that call with a copied local workflow fails the repository policy.
Every clean pull is followed immediately by the explicit public
`verify-release` operation, and every `.prism` transfer includes hidden files.
The acceptance dispatch is independently planted as well: protected `system`
must execute Compose, Kind, and conformance, while `all` additionally requires
the public Pages and clean GHCR roundtrip closures.

The formal mutation gate first verifies the unmodified closed source graph and
then executes twelve isolated LexLean/Lean verifications. Each copy changes one
authoritative `systemModelA` fact while preserving `systemManifestA`: platform
closure, global uniqueness, schema references, interface compatibility,
capability satisfaction, secret consumers, component and migration order,
rollback safety, bounded evidence, artifact licensing, and product release
completeness. Every copy must fail at its corresponding named
`calculatorA...Ready` theorem; a parser-only or host-only rejection does not
satisfy this gate.

The real browser gate changes identity after displaying a user's history and
requires the generated View to clear authenticated controls, rows, and retry
state immediately. It also requires refresh to clear stale rows both during
I/O and after failure, and requires successful recovery to hide the retry
control before exercising the API-produced empty-role `403` state.

The negative gates are load-bearing: forbidden source fallback, invalid model
or standard documents, stale plans, inaccessible history, authorization
failures, dependency and network-policy outages, unbound storage, missing TLS
ingress, missing or stale OIDC signing keys, managed drift, unsafe downgrade,
unclean restore, and unauthorized retirement must all fail with their modeled
diagnostic.

`just vv` has no reduced release mode: it builds each A/B graph once, checks
the portable application and both clean-root reproductions, then runs the
complete Compose, Kubernetes 1.36.4/Kind, and public feature/diagnostic
acceptance. A missing Docker socket, Kind, browser, standard oracle, dependency,
secret, or evidence file is a failure. Live Pages and authenticated GHCR round
trips run in `just accept-production` against explicitly supplied accepted A/B
digest references; they also fail closed and never turn an unavailable
external system into a skip.

The SDK-environment gate hashes every invoked SDK executable, including the
SDK-owned Buildx and Compose plugin files, then invokes both plugin version
surfaces. Docker credentials are confined to a copied or single-file-mounted
`config.json`; a planted user `cli-plugins` directory fails before any build.

The final identity renderer installs `standards.lock` from the selected SDK and
updates the public runtime reference only in the authoritative A/B semantic
records. A planted second-phase failure proves atomic restoration of all
workflows, devcontainer policy, three locks, system source, and LexLean lock;
the corresponding positive case proves a complete transaction is retained.

Protected system acceptance verifies every executable image acquired from an
external registry before it creates either target. The authoritative A/B model
supplies the six application and ingress image identities. The pinned Kind
v1.36.4 node image is separately classified as acceptance infrastructure (not
an application artifact); its exact OCI-index bytes and linux/amd64 and
linux/arm64 children pass the same pull-and-inspect gate.

The repository workflow executes `just vv` twice consecutively from the same
checkout, so stale evidence or cleanup assumptions cannot pass only on a fresh
first run.
