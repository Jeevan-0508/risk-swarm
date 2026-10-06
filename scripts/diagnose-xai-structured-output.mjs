#!/usr/bin/env bun

import { diagnosticConfigFromEnvironment, diagnosticPreflight, formatDiagnosticPreflight, formatDiagnosticReport, runManualDiagnostic } from './diagnose-xai-structured-output.ts';

const config = diagnosticConfigFromEnvironment();
const preflight = diagnosticPreflight(config);
console.log(formatDiagnosticPreflight(preflight));
if (config.confirm !== 'YES') {
  console.log('LIVE_DIAGNOSTIC=NOT_RUN');
  console.log('Set SWARM_XAI_DIAGNOSTIC_CONFIRM=YES to authorize the single diagnostic request.');
  process.exitCode = 0;
} else if (!config.credential) {
  console.log('LIVE_DIAGNOSTIC=NOT_RUN');
  console.log('XAI_API_KEY is absent; no diagnostic request was made.');
  process.exitCode = 0;
} else if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS' || config.output_budget_error !== null || preflight.EFFECTIVE_MAX_OUTPUT_TOKENS === null) {
  console.error('XAI_DIAGNOSTIC_OUTPUT_BUDGET_PREFLIGHT_BLOCKED');
  process.exitCode = 1;
} else {
  try {
    const report = await runManualDiagnostic(config);
    console.log(formatDiagnosticReport(report));
    process.exitCode = 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'XAI_DIAGNOSTIC_FAILED');
    process.exitCode = 1;
  }
}
