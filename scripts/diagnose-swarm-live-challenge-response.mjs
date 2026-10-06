#!/usr/bin/env bun

import { FetchTransport } from '../src/swarm/models/transport.ts';
import { formatPhase5cBudgetPreflight, formatPhase5cReport, phase5cBudgetPreflight, phase5cConfigFromEnvironment, runResponseDiagnostic } from './phase5c-live-diagnostics.ts';

const config = phase5cConfigFromEnvironment(process.env, 'SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM');
const preflight = phase5cBudgetPreflight(config);
console.log(formatPhase5cBudgetPreflight(preflight));
if (config.confirm !== 'YES') {
  console.log('LIVE_CHALLENGE_RESPONSE_DIAGNOSTIC=NOT_RUN');
  console.log('Set SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM=YES to authorize exactly one challenged-seat response request.');
} else if (!config.credential) {
  console.log('LIVE_CHALLENGE_RESPONSE_DIAGNOSTIC=NOT_RUN');
  console.log('XAI_API_KEY is absent; no diagnostic request was made.');
} else if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS') {
  console.error('PHASE5C_CHALLENGE_RESPONSE_OUTPUT_BUDGET_PREFLIGHT_BLOCKED');
  process.exitCode = 1;
} else {
  try {
    const report = await runResponseDiagnostic(config, new FetchTransport());
    console.log(formatPhase5cReport(report));
    process.exitCode = report.PROTOCOL_VALIDATION === 'PASS' ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PHASE5C_CHALLENGE_RESPONSE_DIAGNOSTIC_FAILED');
    process.exitCode = 1;
  }
}
