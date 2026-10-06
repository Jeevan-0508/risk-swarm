import { describe, expect, test } from 'bun:test';
import { MockTransport, type HttpRequest } from '../src/swarm/models/transport';
import { ROUND1_SEAT_IDS } from '../src/swarm/contracts';
import { assessmentForSeat, BudgetedTransport, configFromEnvironment, councilBudgetPreflight, DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS, formatLiveCouncilReport, LIVE_MODEL, LIVE_PROVIDER, LIVE_REQUEST_BUDGET, mockXaiResponse, runRound1Council } from './certify-swarm-live-council';

const ENV_4096 = { SWARM_COUNCIL_PROVIDER: 'xai', SWARM_COUNCIL_MODEL: 'grok-4.7', XAI_API_KEY: 'PHASE4B5_OFFLINE_SECRET_DO_NOT_LEAK', SWARM_LIVE_COUNCIL_CONFIRM: 'YES', SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' };

function seatFromRequest(request: HttpRequest): string {
  const body = JSON.parse(request.body ?? '{}') as { readonly messages?: readonly { readonly role: string; readonly content: string }[] };
  const user = body.messages?.find((message) => message.role === 'user')?.content ?? '';
  const context = JSON.parse(user.split('SEALED_SWARM_CONTEXT_JSON:')[1] ?? '{}') as { readonly seat_id?: string };
  return context.seat_id ?? '';
}

describe('Phase 4B.5 four-seat Council readiness', () => {
  test('environment 4096 resolves before transport and all four serialized requests use 4096', async () => {
    const config = configFromEnvironment(ENV_4096);
    expect(config.max_output_tokens).toBe(4096);
    expect(councilBudgetPreflight(config)).toEqual({ REQUESTED_MAX_OUTPUT_TOKENS: 4096, EFFECTIVE_MAX_OUTPUT_TOKENS: 4096, REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' });
    const run = await runRound1Council(config, new BudgetedTransport(new MockTransport((request) => mockXaiResponse(request, 'SUCCESS')), LIVE_REQUEST_BUDGET), 'offline-credential');
    expect(run.wire_requests).toHaveLength(4);
    expect(run.wire_requests.every((projection) => projection.configured_max_output_tokens === 4096)).toBe(true);
    expect(run.wire_requests.every((projection) => projection.provider === LIVE_PROVIDER && projection.model === LIVE_MODEL && projection.peer_positions_present === false && projection.evidence_fingerprint === 'fnv1a:cd48b0a4')).toBe(true);
    expect(run.seat_reports.every((report) => report.http_status === 200 && report.finish_reason === 'stop' && report.configured_max_output_tokens === 4096 && report.truncation_detected === false && report.provider_output_extracted === 'PASS' && report.json_parse === 'PASS' && report.model_dto_schema_validation === 'PASS' && report.seat_semantic_validation === 'PASS' && report.agent_position_conversion === 'PASS' && report.seat_validation === 'PASS' && report.position_accepted && report.final_execution_status === 'SUCCESS')).toBe(true);
    expect(run.budget).toEqual({ request_count: 4, attempted_count: 4, blocked_count: 0 });
    expect(run.partial_council).toBe(false);
  });

  test('requested/effective mismatch blocks the Council before the first provider call', async () => {
    let calls = 0;
    const config = { provider: LIVE_PROVIDER, model: LIVE_MODEL, credential: 'offline-credential', confirm: 'YES', requested_max_output_tokens: '4096', max_output_tokens: DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS } as const;
    expect(councilBudgetPreflight(config)).toMatchObject({ REQUESTED_MAX_OUTPUT_TOKENS: 4096, EFFECTIVE_MAX_OUTPUT_TOKENS: 1600, REQUESTED_EFFECTIVE_MISMATCH_GATE: 'BLOCKED' });
    await expect(runRound1Council(config, new MockTransport(() => { calls += 1; return { status: 200, headers: {}, body: '{}' }; }))).rejects.toThrow('REQUESTED_EFFECTIVE_OUTPUT_TOKEN_MISMATCH');
    expect(calls).toBe(0);
  });

  test('one truncated seat is rejected while other successful positions remain preserved', async () => {
    const config = configFromEnvironment(ENV_4096);
    const transport = new MockTransport((request) => {
      if (seatFromRequest(request) === 'ARES') return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: '{"conclusion":' }, finish_reason: 'length' }], usage: { completion_tokens: 4096 } }) };
      return mockXaiResponse(request, 'SUCCESS');
    });
    const run = await runRound1Council(config, new BudgetedTransport(transport, LIVE_REQUEST_BUDGET), 'offline-credential');
    const ares = run.seat_reports.find((report) => report.seat === 'ARES');
    expect(ares).toMatchObject({ http_status: 200, finish_reason: 'length', configured_max_output_tokens: 4096, output_tokens: 4096, truncation_detected: true, provider_output_extracted: 'PASS', json_parse: 'NOT_RUN', model_dto_schema_validation: 'NOT_RUN', seat_semantic_validation: 'NOT_RUN', agent_position_conversion: 'NOT_RUN', seat_validation: 'FAIL', position_accepted: false, final_execution_status: 'REJECTED', failure_stage: 'RESPONSE_TRUNCATED', failure_code: 'OUTPUT_TOKEN_LIMIT' });
    expect(run.seat_reports.filter((report) => report.seat !== 'ARES').every((report) => report.position_accepted && report.final_execution_status === 'SUCCESS')).toBe(true);
    expect(run.blackboard.positions.map((position) => position.seat_id)).toEqual(ROUND1_SEAT_IDS.filter((seat) => seat !== 'ARES'));
    expect(run.partial_council).toBe(true);
    expect(run.budget).toEqual({ request_count: 4, attempted_count: 4, blocked_count: 0 });
    expect(run.blackboard.synthesis).toBeNull();
    expect(run.blackboard.execution_events.some((event) => event.actor === 'ZEUS')).toBe(false);
    expect(formatLiveCouncilReport(run)).not.toContain('PHASE4B5_OFFLINE_SECRET_DO_NOT_LEAK');
  });

  test('the readiness path leaves strict schema, retry, fallback, evidence, and governance boundaries unchanged', async () => {
    const config = configFromEnvironment(ENV_4096);
    const run = await runRound1Council(config, new BudgetedTransport(new MockTransport((request) => mockXaiResponse(request, 'SUCCESS')), LIVE_REQUEST_BUDGET), 'offline-credential');
    expect(run.wire_requests.every((projection) => projection.response_format_type === 'STRICT_JSON_SCHEMA' && projection.json_schema_name === 'swarm_seat_assessment_v1' && projection.strict_value === true && projection.provider_schema_fingerprint === 'fnv1a:835100c1')).toBe(true);
    expect(run.audit.finding_count).toBeGreaterThan(0);
    expect(run.blackboard.disagreements.length).toBeGreaterThan(0);
    expect(run.blackboard.execution_events.some((event) => event.type === 'CHALLENGE_EMITTED')).toBe(false);
    expect(run.blackboard.synthesis).toBeNull();
    expect(run.blackboard.human_decision).toBeNull();
    expect(assessmentForSeat('ATHENA').claims.length).toBeGreaterThan(0);
  });
});
