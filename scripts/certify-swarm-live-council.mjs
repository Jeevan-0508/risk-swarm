#!/usr/bin/env bun

import { configFromEnvironment, councilBudgetPreflight, formatCouncilBudgetPreflight, formatLiveCouncilReport, runManualLiveCouncil } from './certify-swarm-live-council.ts';

const config = configFromEnvironment();
const preflight = councilBudgetPreflight(config);
console.log(formatCouncilBudgetPreflight(preflight));
if (config.confirm !== 'YES') {
  console.log('LIVE_COUNCIL_EXECUTION=NOT_RUN');
  console.log('Set SWARM_LIVE_COUNCIL_CONFIRM=YES to authorize the manual live run.');
  process.exitCode = 0;
} else if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS' || preflight.EFFECTIVE_MAX_OUTPUT_TOKENS !== 4096) {
  console.error('LIVE_COUNCIL_OUTPUT_BUDGET_PREFLIGHT_BLOCKED');
  process.exitCode = 1;
} else {
  try {
    const result = await runManualLiveCouncil(config);
    console.log(formatLiveCouncilReport(result));
    process.exitCode = result.budget.attempted_count === 4 && result.budget.blocked_count === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'LIVE_COUNCIL_FAILED');
    process.exitCode = 1;
  }
}
