/**
 * Prints the demo investigation from the command line. No key, no network, no arguments.
 * Its job is to make the honest answer visible before anyone opens the UI.
 */
import { createFileLoader } from '../src/core/integrations/loader.node';
import { investigate } from '../src/core/orchestrator/run';

const result = await investigate({
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-DEMO',
  now: new Date('2026-09-13T00:00:00.000Z').toISOString(),
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
});

const { decision, actions, score } = result.outputs.decision;
const line = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

console.log(`\n${result.question}\n`);
line('recommendation', `${decision.action_band}  (severity ${decision.severity_band} ${decision.severity_score}, urgency ${decision.urgency})`);
line('confidence', decision.confidence === null ? `withheld - ${decision.confidence_blocked_reason}` : decision.confidence);
line('disagreement index', score.disagreement_index.value);
line('graph', `${result.graph.all().length} nodes, ${result.graph.edges().length} edges, intact ${result.graph.isIntact()}, cycles ${result.graph.cycles().length}`);
line('agents', result.log.map((l) => `${l.phase}:${l.findings}`).join(' '));
line('budget spent', `${result.spent.agent_call} agent calls, ${result.spent.retrieval} retrievals, ${result.spent.tokens} tokens`);

console.log('\nwhy:');
for (const r of decision.rationale) console.log(`  - ${r}`);
console.log('\nunmet escalation requirements:');
for (const g of decision.gates_failed) console.log(`  - ${g}`);
console.log('\nnext actions:');
for (const a of actions) console.log(`  - [${a.class}] ${a.text.slice(0, 120)}${a.text.length > 120 ? '...' : ''}`);
console.log('');
