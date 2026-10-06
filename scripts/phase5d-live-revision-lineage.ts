import { buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation, type OfflineSwarmRunResult } from '../src/swarm/engine/offline';
import { mockTransport, phase5cConfigFromEnvironment } from './phase5c-live-diagnostics';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/swarm/models/transport';

export async function runPhase5dOfflineLifecycle(): Promise<OfflineSwarmRunResult> {
  return runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
}

export function configForPhase5d() {
  return phase5cConfigFromEnvironment({
    SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096',
    XAI_API_KEY: 'PHASE5D_OFFLINE_TEST_SECRET',
    SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM: 'YES',
  }, 'SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM');
}

export function mockTransportForPhase5d(): HttpTransport {
  return mockTransport();
}

export class Phase5dTransport implements HttpTransport {
  constructor(private readonly outputTokens: number) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const response = await mockTransport().request(request);
    const body = JSON.parse(response.body ?? '{}') as Record<string, unknown>;
    body.usage = { completion_tokens: this.outputTokens };
    return { ...response, body: JSON.stringify(body) };
  }
}
