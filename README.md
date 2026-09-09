# Calculator

Calculator is the reference PrismPM product: one authoritative application
model plus one authoritative production-system model become a portable Pages
application and complete A/B service releases.

The production SDK migration is not yet released. Its SDK/template locks and
workflow image/commit bindings must be rendered from the accepted public SDK
and runtime images before opening the new devcontainer or running production
CI. The historical baseline record remains explicitly unsealed until the
public crates, regenerated Pages closure, and complete clean verification
transcripts are available. These checks fail when release evidence is absent.

## Build, push, run

Open the repository in its devcontainer. The container is the exact SDK image
recorded in `prismpm.lock`; the host needs only Git, Docker, and a devcontainer
client. Only Docker's read-only `config.json` crosses into the container; host
CLI plugins cannot shadow the SDK-owned Buildx and Compose plugins.

```console
just setup
just build
source .prism/repository-evidence/releases.env
prismpm push "$CALCULATOR_RELEASE_A"
prismpm push "$CALCULATOR_RELEASE_B"
prismpm run --detach --target compose-local "$CALCULATOR_RELEASE_B"
```

No command compiles PrismPM source, searches the host `PATH` for a fallback, or
regenerates during push, pull, run, or deploy. Cargo consumes the exact
`prism-calculator` and `prism-stdlib` versions from the public registry.
The protected production workflow isolates the read-only build job from the
OIDC/package-write candidate publication job, derives signing policy and
Sigstore trust material inside the SDK, signs and promotes the unchanged root
to candidate, pushes it, accepts a clean pull, then promotes and pushes the same
root as accepted with its lifecycle evidence. A final read-only clean job pulls
the releases and uses `verify-release` to cryptographically replay the complete
signature and candidate-to-accepted promotion chain. After the full
acceptance lifecycle, the protected job signs and verifies one canonical
closure over every deployment, rollback, restore, and retirement evidence
referrer before the final push.

## Inspect and deploy

```console
prismpm inspect "$CALCULATOR_RELEASE_B"
prismpm verify-release "$CALCULATOR_RELEASE_B"
plan=$(prismpm --json plan --target kubernetes-kind "$CALCULATOR_RELEASE_B")
prismpm deploy --target kubernetes-kind \
  --plan "$(printf '%s' "$plan" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).plan_digest))')" \
  "$CALCULATOR_RELEASE_B"
prismpm status --target kubernetes-kind "$CALCULATOR_RELEASE_B"
prismpm rollback --target kubernetes-kind "$CALCULATOR_RELEASE_A"
prismpm backup --target compose-local "$CALCULATOR_RELEASE_B"
prismpm finalize-contract --target compose-local --authorized "$CALCULATOR_RELEASE_B"
prismpm template check
prismpm lock check
```

`just accept-production` requires `CALCULATOR_RELEASE_A` and
`CALCULATOR_RELEASE_B` to name the exact accepted GHCR digest references; it
fails rather than silently building unsigned local substitutes. It performs
the authenticated registry round trip and exercises real Compose and
Kubernetes 1.36.4/Kind targets. It proves readiness, HTTP and View
acceptance, OIDC user/auditor policy, idempotency and concurrency, complete i64
boundaries, ordered isolated history, outbox/audit deduplication, dependency
outage and recovery, OpenTelemetry receipt and redaction, SLOs, A-to-B
migration, managed drift, rollback, destructive-downgrade refusal, logical
backup/restore to a clean target, and authorized reverse-order cleanup.
The Compose gate also launches the generated foreground supervisor, sends it a
real interrupt, requires its reverse-dependency graceful-shutdown result, and
proves that no managed process remains.
Release B first remains binary-compatible with A through its expand phase. The
separately authorized, idempotent `finalize-contract` operation executes the
modeled SQL and records B as the minimum compatible data release; subsequent A
deployment and rollback attempts must fail with `PP7601` without changing the
target.

The Compose and Kind gates call the generated service rather than substituting
a test server. They exercise every arithmetic operation at signed-64-bit
boundaries, accepted domain errors, the closed HTTP error surface, OIDC
signature/issuer/audience/time/subject/role failures, subject isolation,
default and explicit pagination, concurrent idempotency, and the generated
OpenAPI-only View. Compose additionally replays the same outbox event twice and
queries PostgreSQL to prove one audit row, then inspects exported Collector
signals for correlation and the absence of the modeled redaction canary. The
View acceptance obtains a real empty-role OIDC principal for its API-produced
403/access-denied state and stops the deployed database for its failure/retry
state; it never intercepts or fabricates an HTTP response. Kind
deploys A first through the pinned ingress-nginx controller and the modeled TLS
Ingress, proves both static retained PV/PVC bindings, and exercises the API and
View without a port-forward. It observes process, database, broker, issuer,
Collector, network-policy, credential, resource-limit, and managed-drift
failures; proves recovery and a stopped B migration; observes the live A/B
compatibility window; rotates the Ingress certificate and modeled late-bound
OIDC signing key; rolls back while
compatible; finalizes the contract gate; and rejects the unsafe downgrade
before authorized retirement.
The final Kind backup is restored into a newly created cluster, so the clean
target has neither source-cluster API objects nor retained host-path bytes;
PrismPM then compares the full logical PostgreSQL dump and reruns the generated
API and View acceptance through TLS ingress. Both restore targets are then
retired through PrismPM itself, including their recorded target-profile
binding, so the complete gate can run again without hidden target state.

For each A/B release, `just accept-conformance` executes the SDK-shipped
runner against every public capability ID and registered diagnostic trigger in
that locked SDK. PrismPM binds the canonical transcript to the exact release,
capability-coverage, SDK, and runner digests, then exercises the independent
acceptance-attachment boundary. This complements the Calculator-specific live
scenarios; it does not replace them with inferred or file-existence evidence.

## Authoritative model

- [`src/Calculator.lex.tex`](src/Calculator.lex.tex) is the unchanged
  getting-started application authority. It defines checked signed-64-bit
  arithmetic, Cargo/Core-Wasm, Holo/1, View, and the portable Pages profile.
- [`src/CalculatorSystem.lex.tex`](src/CalculatorSystem.lex.tex) imports that
  exact application module. It is the only authority for service interfaces,
  JSON/HTTP, OIDC, history/idempotency, CloudEvents/outbox, PostgreSQL,
  observability, Compose/Kubernetes topology, migrations, operations, and
  releases A and B.

LexLean generates Lean; lean4-prod compiles generated declarations. There is no
handwritten Lean and no handwritten Calculator API, SQL, event, UI, or
deployment behavior.

[`CALCULATOR-VERIFICATION.md`](CALCULATOR-VERIFICATION.md) maps the Calculator
model and acceptance surfaces to their concrete gates. `VERIFICATION.md` is
the byte-bound universal template policy and is intentionally not
Calculator-specific.

## Generated production closure

Each immutable product release includes:

- OpenAPI 3.2 and AsyncAPI 3.1 interfaces and CloudEvents 1.0 facts;
- generated browser/API/audit-worker behavior and production typed View;
- PostgreSQL schema plus A/B expand-compatible migration;
- Compose and Kubernetes 1.36.4 target projections;
- Calculator `.holo`, Core-Wasm, packages, component-image references;
- SPDX 3 BOM, SLSA/in-toto provenance, oracle validation, signature and
  lifecycle evidence; and
- `projections/capability-coverage.json`, mapping every public PrismPM 0.3.0
  feature and diagnostic family to modeled positive/negative acceptance. Each
  row is explicitly public and binds its exact PrismPM register source, its
  generated projection row, and either byte-sorted authority IDs from the
  locked standards catalog or an explicit Prism-owned `none` reason.

`just update-system-projection` is the only supported way to update the
committed public-feature matrix. It uses the locked SDK to build release B,
validates the complete generated system projection, validates every strict
feature/diagnostic/source/output/authority link, and then installs only the
exact generated `artifacts/feature-coverage.json` bytes with their checksum and
canonical generation evidence. `just verify-system-projection` independently
rebuilds and byte-compares that committed projection.

`just vv` checks the committed public projection against a fresh generated
build and reproduces A, B, Pages, and each complete OCI graph from two clean
absolute roots on the same architecture. The separate architecture matrix
requires every platform-independent generated byte to match. The model permits
only the child image selected from each pinned multi-platform runtime index to
differ between `linux/amd64` and `linux/arm64`; the semantic snapshot,
interfaces, target projections, root manifest, and referrers do not.
That classification and comparison are made only by the SDK's canonical
`prismpm/platform-equivalence/1` report; Calculator supplies the two clean
architecture roots and does not maintain a second exclusion list.

The canonical `prismpm/calculator-baseline/1` record preserves the exact
historical application and deployed Pages identities, including the observed
absence of the claimed 0.1.0 crates. Its separate remediation closure can be
sealed only after the regenerated projection, current public crates, and all
clean command transcripts are independently verified. Every repository,
browser, and production gate rejects an unsealed baseline.
Historical artifacts are always reconstructed from the historical Pages/release
commit recorded under `historical`; sealing advances the separate repository
execution binding to the input-ready commit without rewriting that history.
The exact former `RELEASE-CANDIDATE.json` bytes remain preserved as
`artifacts/historical-release-candidate.json` and are compared directly with
that historical commit even after the obsolete top-level candidate file and
local registry are removed.
The plan against which that candidate was accepted is likewise preserved at
`artifacts/historical-plan-05sep26.md`; its fixed title and byte digest are
checked locally rather than depending on a mutable external working-tree path.

The final release renderer takes the exact public SDK image, shared Action
commit, reviewed template policy commit, and public runtime image index:

```console
bootstrap/render.sh SDK@sha256:DIGEST UOR-Foundation/PrismPM/action@COMMIT TEMPLATE_POLICY_COMMIT ghcr.io/uor-foundation/prismpm-runtime@sha256:DIGEST
```

It installs the SDK's exact `standards.lock`, parses and updates the A/B runtime
artifact records in the authoritative system model, and regenerates
`lexlean.lock` through that SDK. It never patches a generated projection. The
devcontainer, every workflow, all three locks, the system source, and the
LexLean lock form one render transaction: any failed phase restores every
preexisting byte and removes outputs that did not exist before the attempt.

The pre-seal bootstrap phase is `just baseline-input`: before the first seal
exists, it validates the draft record, runs the same local, Compose, clean
Kind, conformance, reproducibility, package, browser, and live-Pages checks,
and emits canonical `calculator/baseline-input-evidence/1` bytes under
`.prism/repository-evidence/`. It does not publish, promote, or deploy through
the protected release workflow. Its digest is recorded as the Calculator
baseline input; after sealing, ordinary `just vv`, browser, Pages, production,
and CI paths continue to require the seal.

Capture the five required clean executions inside the exact SDK image from
`prismpm.lock`. The capture tool runs an argument vector directly and checks
clean Git state before and after, for example:

```console
PRISMPM_EXECUTION_IMAGE="$SDK_IMAGE" PRISMPM_EXECUTION_KIND=devcontainer \
  node /path/to/calculator-example/scripts/capture-baseline-run.mjs \
  https://github.com/UOR-Foundation/PrismPM 1 "$SDK_IMAGE" /evidence/prismpm-1.json -- just vv
```

The exact evidence filenames and commands are `prismpm-1.json` / `just vv`,
`prismpm-2.json` / `just vv`, `calculator-example-1.json` /
`just baseline-input`, `lexlean-1.json` / `just vv`, and
`lean4-prod-1.json` / `just ci`. Each canonical file binds its repository,
full HEAD object ID, repeat, clean-worktree result, SDK manifest, exit result,
and complete base64-encoded stdout/stderr. Run `just seal-baseline /evidence`
only after all five pass. It rejects missing, extra, stale, dirty, failed,
noncanonical, or tampered evidence; copies the immutable files under
`artifacts/baseline-evidence`; updates all run and repository bindings;
validates the closed schema; rewrites checksums; and refuses overwrite.

## Pages profile

The public portable Calculator remains at
<https://uor-foundation.github.io/calculator-example/>. It is a self-contained
six-file Holo/1/wasm application, not the stateful service target.

```console
just accept-pages
```

That gate compares every served HTTPS byte with the generated local closure,
runs modeled browser trace equivalence against the live HTTPS origin, checks
WCAG 2.2 A/AA behavior, and records a canonical publication closure containing
the exact commit, URL, six asset sizes/digests, and corrected `index.html`
identity. Before the first seal, a protected manual Pages run with
`baseline-bootstrap: true` publishes that already generated closure while the
record still says the correction is absent. Its projection-bootstrap gate is
confined to Pages and compares the committed six files with fresh generator
output and then with the live site. `just prepare-baseline YYYY-MM-DD` may mark
the projection present only after that live comparison succeeds; normal pushes
and every later deployment still require the sealed baseline.

The first corrected publication has an explicit, non-circular sequence:

1. In the locked SDK, run `just update-application-projection`; it replaces
   only the six application evidence files and six Pages files with the exact
   `prismpm build`/`prismpm verify` output, then rewrites `SHA256SUMS`.
2. Run `just update-system-projection` and then
   `just verify-system-projection`; this installs only the generator's strict
   release-B public-feature matrix. Run `just verify-application-projection`,
   review both generic-generator diffs, and commit those projection inputs.
3. Dispatch the Pages workflow on protected `main` with
   `baseline-bootstrap: true`. This is the sole pre-seal publication path; it
   rejects existing remediation claims, publishes without rebuilding, and
   compares every live byte and browser behavior with the committed output.
4. After the exact generated `prism-calculator` and SDK-carried
   `prism-stdlib` archives are public, run `just prepare-baseline YYYY-MM-DD`.
   It downloads both crates and the live Pages closure, requires byte equality
   with the local candidates, and writes the input-ready unsealed record.
5. Commit that input record, run `just baseline-input`, retain its canonical
   evidence, and seal only after every recorded repository transcript exists.
   All subsequent Pages runs take the ordinary sealed-only path.

Ordinary Pages publication is part of the protected production graph. The
production workflow passes the exact accepted release-B digest to the reusable
Pages workflow only after a clean GHCR pull and independent `verify-release`.
That workflow repeats the clean pull and trust replay, requires the complete
accepted signature closure, extracts all six `view/browser/*` assets from the
immutable release, and byte-compares them with `public/` before deployment. It
does not invoke source generation, build, or application verification in this
publication mode; those checks have already passed before the accepted graph
was created.
A push or pull request therefore validates Pages but cannot publish it; only a
protected ref can use either publication path, and the manual
baseline-bootstrap sequence above is the only deliberately confined
pre-accepted exception.

The `Publish exact generated Calculator crate` workflow is the only pre-seal
crate-publication path. It runs on a protected ref in the `crates-io`
environment, obtains a short-lived token through crates.io trusted publishing,
and uses the SDK's pinned Cargo. Cargo first packages the generated source
closure and must byte-match PrismPM's attested `.crate`; after publication the
workflow independently checks both the crates.io registry checksum and the
downloaded archive bytes. Configure the crates.io trusted publisher for this
repository, workflow filename, and environment—no long-lived Cargo token is
accepted. The short-lived token is removed from the environment before model
fetch, build, verification, packaging, and public-registry inspection; it is
provided only to the single pinned `cargo publish` child process.

## SDK and template updates

The devcontainer, Actions, `prismpm.lock`, and `template.lock` all select the
same immutable SDK manifest. The initial migration invokes
`bootstrap/render.sh` with the exact public SDK, Action, reviewed template
policy-input commit, and runtime index; because neither lock exists in the
historical repository, that one transaction consumes the reviewed migration
worktree and produces both locks together. After they are committed, every
later render rejects an untracked, dirty, or one-lock policy state. Updates are
explicit reviewable patches:

```console
prismpm lock update --sdk-image NAME@sha256:DIGEST
prismpm template update --sdk-image NAME@sha256:DIGEST \
  --template-revision FULL_COMMIT
```

No template or SDK update mutates the default branch implicitly.

## Licenses

Licensed under either Apache License 2.0 or MIT, at your option.
