const actionLine = /^\s*(?:-\s*)?uses:\s+(\S+)(?:\s+#.*)?$/;
const immutableAction = /^[^\s@]+\/[^\s@]+@[0-9a-f]{40}$/;
const prismPlaceholder = /^UOR-Foundation\/PrismPM\/action@__PRISMPM_ACTION_COMMIT__$/;
const reusablePlaceholder = /^UOR-Foundation\/PrismPM\/\.github\/workflows\/sdk\.yml@__PRISMPM_ACTION_COMMIT__$/;
const prismMarker = /^UOR-Foundation\/PrismPM\/action$/;
const localReusableWorkflow = /^\.\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;

export function validateWorkflowPolicy(workflows) {
  if (!(workflows instanceof Map) || workflows.size === 0) {
    throw new Error('workflow closure is absent');
  }
  for (const [name, source] of workflows) {
    if (typeof source !== 'string' || !/^name:\s+\S/m.test(source)) {
      throw new Error(`${name} is not a workflow document`);
    }
    if (/\bubuntu-latest\b/.test(source)) {
      throw new Error(`${name} uses a floating runner`);
    }
    if (/continue-on-error:\s*true/.test(source)) {
      throw new Error(`${name} permits a failed gate`);
    }
    if (/--volume\s+"\$HOME\/\.docker:/.test(source)) {
      throw new Error(`${name} mounts host Docker CLI plugins into the SDK`);
    }
    if (name === 'prismpm.yml' &&
        !/^\s{8}default:\s*kubernetes-kind\s*$/m.test(source)) {
      throw new Error(`${name} does not default to Calculator's modeled Kubernetes target`);
    }
    if (name === 'prismpm.yml') {
      const deployStart = source.indexOf('\n  deploy:\n');
      const deployEnd = source.indexOf('\n  verify-deployment:\n', deployStart);
      const deployJob = deployStart >= 0 && deployEnd > deployStart
        ? source.slice(deployStart, deployEnd)
        : '';
      if (!deployJob || /^\s{6}id-token:\s*write\s*$/m.test(deployJob)) {
        throw new Error(`${name} grants signing identity to the unsigned deploy job`);
      }
      const conformance = source.indexOf('          command: conformance\n');
      const evidenceSignature = source.indexOf('          command: sign-evidence\n');
      if (conformance < 0 || evidenceSignature < 0 || conformance > evidenceSignature ||
          !source.includes(
            'needs: [resolve-sdk, promote, deploy, verify-deployment, conformance]')) {
        throw new Error(`${name} permits accepted promotion to bypass production conformance`);
      }
    }
    if (name === 'pages.yml') {
      const deployCondition =
        "if: (inputs.release-reference != '' && github.ref_protected) || " +
        "(inputs.baseline-bootstrap && github.event_name == 'workflow_dispatch' && " +
        "github.ref == 'refs/heads/main' && github.ref_protected)";
      const requiredReleaseFiles = [
        'app.css',
        'app.js',
        'index.html',
        'prism_calculator.js',
        'prism_calculator_bg.wasm',
        'provenance.json',
      ];
      if (!source.includes(deployCondition) ||
          !source.includes('          command: verify-release\n') ||
          !source.includes('          test "$REF_PROTECTED" = true\n') ||
          source.split("        if: inputs.release-reference == ''\n").length < 4 ||
          !source.includes('result.status !== "accepted"') ||
          !source.includes('system.product?.version !== "B"') ||
          !source.includes('cmp "$temporary/$name" "public/$name"') ||
          requiredReleaseFiles.some((name) => !source.includes(name))) {
        throw new Error(`${name} can publish Pages without an exact accepted release byte binding`);
      }
    }
    if (name === 'production.yml') {
      const pagesStart = source.indexOf('\n  publish-pages:\n');
      const pagesJob = pagesStart >= 0 ? source.slice(pagesStart) : '';
      if (!pagesJob.includes('    needs: [build, verify-published]\n') ||
          !pagesJob.includes('    uses: ./.github/workflows/pages.yml\n') ||
          !pagesJob.includes(
            '      release-reference: ghcr.io/uor-foundation/calculator-system@${{ needs.build.outputs.release-b }}\n')) {
        throw new Error(`${name} does not publish the exact verified accepted release through Pages`);
      }
    }
    if (name === 'verify.yml' &&
        (!/^    uses: UOR-Foundation\/PrismPM\/\.github\/workflows\/sdk\.yml@(?:[0-9a-f]{40}|__PRISMPM_ACTION_COMMIT__)$/m.test(source) ||
         !source.includes('        release: [A, B]\n') ||
         !source.includes('      release: ${{ matrix.release }}\n'))) {
      throw new Error(`${name} does not consume the released read-only pipeline for both releases`);
    }
    if (name === 'template-update.yml') {
      const copy = source.match(/for path in (.+); do/);
      const paths = copy?.[1].split(' ');
      if (/\.github\/(?:workflows\/(?:ci|honesty)\.yml|actions\/prismpm)/.test(source) ||
          JSON.stringify(paths) !== JSON.stringify([
        'AGENTS.md', 'VERIFICATION.md', 'template-contract.json', '.github/workflows/bootstrap.yml',
      ]) || !source.includes('./bootstrap/render.sh "$SDK_IMAGE" "$ACTION_REFERENCE" "$TEMPLATE_REVISION" "$RUNTIME_IMAGE"') ||
          !source.includes('prismpm.lock standards.lock template-contract.json template.lock') ||
          !source.includes('src/CalculatorSystem.lex.tex lexlean.lock') ||
          !source.includes('git diff --binary "$proposal_base"') ||
          !source.includes('"$SDK_IMAGE" just model-write')) {
        throw new Error(`${name} does not preserve project ownership and the complete runtime update transaction`);
      }
    }
    for (const line of source.split('\n')) {
      const match = actionLine.exec(line);
      if (!match) continue;
      const action = match[1];
      const marker = line.includes('# prismpm-action-input');
      if (immutableAction.test(action) || localReusableWorkflow.test(action) ||
          prismPlaceholder.test(action) || reusablePlaceholder.test(action) ||
          (marker && prismMarker.test(action))) continue;
      throw new Error(`${name} has a non-immutable action reference: ${action}`);
    }

    const steps = source.split(/\n(?= {6}- )/);
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (/actions\/checkout@/.test(step) &&
          (!/^\s*fetch-depth:\s*0\s*$/m.test(step) ||
           !/^\s*persist-credentials:\s*false\s*$/m.test(step))) {
        throw new Error(`${name} checkout does not fetch exact history without retained credentials`);
      }
      if (/^\s*command:\s*pull\s*$/m.test(step)) {
        if (!/^\s*command:\s*verify-release\s*$/m.test(steps[index + 1] ?? '')) {
          throw new Error(`${name} does not explicitly verify-release immediately after pull`);
        }
      }
      if (/actions\/upload-artifact@/.test(step) && /^\s*path:\s*\.prism\s*$/m.test(step) &&
          !/^\s*include-hidden-files:\s*true\s*$/m.test(step)) {
        throw new Error(`${name} omits hidden release-store files from an upload`);
      }
    }
  }
}
