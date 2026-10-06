import { describe, expect, it } from '../src/core/test/bdd';
import { MockTransport, type HttpResponse } from '../src/swarm/models/transport';
import { certificationTestSecret, formatCertificationReport, runCertification } from './certify-swarm-model-runtime';

const CONFIG = { provider: 'gemini', model: 'gemini-certification-model', credential: certificationTestSecret };

function response(status: number, body: string): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

function mockRun(result: HttpResponse | Error): Promise<Awaited<ReturnType<typeof runCertification>>> {
  const transport = new MockTransport(() => {
    if (result instanceof Error) return Promise.reject(result);
    return result;
  });
  return runCertification(CONFIG, transport);
}

describe('Phase 3B certification harness', () => {
  it('passes only for one exact structured live result through the new runtime path', async () => {
    const run = await mockRun(response(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"OK","confidence":1}' }] }, finishReason: 'STOP' }] })));
    expect(run.report.CERTIFICATION_RESULT).toBe('PASS');
    expect(run.report.REQUEST_COUNT).toBe(1);
    expect(run.report.REQUESTED_PROVIDER).toBe('gemini');
    expect(run.report.REQUESTED_MODEL).toBe(CONFIG.model);
    expect(run.report.EXECUTED_PROVIDER).toBe('gemini');
    expect(run.report.EXECUTED_MODEL).toBe(CONFIG.model);
    expect(run.report.FALLBACK_USED).toBe(false);
    expect(run.report.ATTEMPT_COUNT).toBe(1);
    expect(run.report.STRUCTURED_VALIDATION).toBe('PASS');
    expect(run.report.SUMMARY_MATCH).toBe(true);
    expect(run.report.CONFIDENCE_MATCH).toBe(true);
    expect(run.report.REAL_MODEL_CALLED).toBe(true);
    expect(run.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(run.report.PROVIDER_RESPONSE_RECEIVED).toBe(true);
    expect(run.report.MODEL_INFERENCE_SUCCEEDED).toBe(true);
    expect(run.report.MODEL_OUTPUT_PRESENT).toBe(true);
    expect(run.report.MODEL_OUTPUT_ACCEPTED).toBe(true);
    expect(run.report.STRUCTURED_VALIDATION).toBe('PASS');
    expect(run.report.SECRET_LEAK_CHECK).toBe('PASS');
  });

  it('preserves the exact recorded Gemini 503 forensic facts', async () => {
    const run = await runCertification({ ...CONFIG, model: 'gemini-3.8-flash' }, new MockTransport(() => response(503, JSON.stringify({ error: { message: certificationTestSecret } }))));
    expect(run.report.CERT_PROVIDER).toBe('gemini');
    expect(run.report.CERT_MODEL).toBe('gemini-3.8-flash');
    expect(run.report.REQUEST_COUNT).toBe(1);
    expect(run.report.REQUESTED_PROVIDER).toBe('gemini');
    expect(run.report.REQUESTED_MODEL).toBe('gemini-3.8-flash');
    expect(run.response?.attempts[0]?.provider).toBe('gemini');
    expect(run.response?.attempts[0]?.model).toBe('gemini-3.8-flash');
    expect(run.report.EXECUTED_PROVIDER).toBe(null);
    expect(run.report.EXECUTED_MODEL).toBe(null);
    expect(run.report.FALLBACK_USED).toBe(false);
    expect(run.report.FINAL_STATUS).toBe('UNAVAILABLE');
    expect(run.report.FAILURE_STAGE).toBe('HTTP');
    expect(run.report.FAILURE_REASON_CODE).toBe('PROVIDER_UNAVAILABLE');
    expect(run.report.HTTP_STATUS).toBe(503);
    expect(run.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(run.report.PROVIDER_RESPONSE_RECEIVED).toBe(true);
    expect(run.report.MODEL_INFERENCE_SUCCEEDED).toBe(false);
    expect(run.report.MODEL_OUTPUT_PRESENT).toBe(false);
    expect(run.report.MODEL_OUTPUT_ACCEPTED).toBe(false);
    expect(run.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');
    expect(run.report.ATTEMPT_COUNT).toBe(1);
    expect(run.report.SECRET_LEAK_CHECK).toBe('PASS');
    expect(run.report.CERTIFICATION_RESULT).toBe('FAIL');
  });

  it('normalizes required HTTP provider failures with one request and no fallback', async () => {
    const cases = [
      [401, 'AUTHENTICATION'],
      [403, 'AUTHORIZATION'],
      [404, 'MODEL_NOT_FOUND'],
      [429, 'RATE_LIMITED'],
      [500, 'PROVIDER_HTTP_ERROR'],
      [503, 'PROVIDER_UNAVAILABLE'],
    ] as const;
    for (const [status, code] of cases) {
      const run = await mockRun(response(status, JSON.stringify({ error: { message: certificationTestSecret } })));
      expect(run.report.CERTIFICATION_RESULT, String(status)).toBe('FAIL');
      expect(run.report.REQUEST_COUNT, String(status)).toBe(1);
      expect(run.report.HTTP_STATUS, String(status)).toBe(status);
      expect(run.report.FAILURE_REASON_CODE, String(status)).toBe(code);
      expect(run.report.FALLBACK_USED, String(status)).toBe(false);
      expect(run.report.ATTEMPT_COUNT, String(status)).toBe(1);
      expect(run.report.PROVIDER_REQUEST_ATTEMPTED, String(status)).toBe(true);
      expect(run.report.PROVIDER_RESPONSE_RECEIVED, String(status)).toBe(true);
      expect(run.report.MODEL_INFERENCE_SUCCEEDED, String(status)).toBe(false);
      expect(run.report.MODEL_OUTPUT_PRESENT, String(status)).toBe(false);
      expect(run.report.MODEL_OUTPUT_ACCEPTED, String(status)).toBe(false);
      expect(run.report.STRUCTURED_VALIDATION, String(status)).toBe('NOT_RUN');
      expect(run.report.STRUCTURED_OUTPUT_PRESENT, String(status)).toBe(false);
      expect(JSON.stringify(run)).not.toContain(certificationTestSecret);
    }
  });

  it('normalizes timeout and network failures without exposing exception text', async () => {
    const timeout = new Error(certificationTestSecret);
    timeout.name = 'AbortError';
    const timeoutRun = await mockRun(timeout);
    expect(timeoutRun.report.FAILURE_REASON_CODE).toBe('TIMEOUT');
    expect(timeoutRun.report.FAILURE_STAGE).toBe('REQUEST');
    expect(timeoutRun.report.REQUEST_COUNT).toBe(1);
    expect(timeoutRun.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(timeoutRun.report.PROVIDER_RESPONSE_RECEIVED).toBe(false);
    expect(timeoutRun.report.MODEL_OUTPUT_PRESENT).toBe(false);
    expect(timeoutRun.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');
    expect(JSON.stringify(timeoutRun)).not.toContain(certificationTestSecret);

    const network = new Error(`connect failed ${certificationTestSecret}`);
    network.name = 'NetworkError';
    const networkRun = await mockRun(network);
    expect(networkRun.report.FAILURE_REASON_CODE).toBe('NETWORK');
    expect(networkRun.report.FAILURE_STAGE).toBe('REQUEST');
    expect(networkRun.report.REQUEST_COUNT).toBe(1);
    expect(networkRun.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(networkRun.report.PROVIDER_RESPONSE_RECEIVED).toBe(false);
    expect(networkRun.report.MODEL_OUTPUT_PRESENT).toBe(false);
    expect(networkRun.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');
    expect(JSON.stringify(networkRun)).not.toContain(certificationTestSecret);
  });

  it('distinguishes malformed provider JSON from schema-invalid model JSON', async () => {
    const malformed = await mockRun(response(200, '{not-json'));
    expect(malformed.report.FAILURE_REASON_CODE).toBe('RESPONSE_PARSE_ERROR');
    expect(malformed.report.FAILURE_STAGE).toBe('RESPONSE_PARSE');
    expect(malformed.report.STRUCTURED_OUTPUT_PRESENT).toBe(false);
    expect(malformed.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(malformed.report.PROVIDER_RESPONSE_RECEIVED).toBe(true);
    expect(malformed.report.MODEL_INFERENCE_SUCCEEDED).toBe(false);
    expect(malformed.report.MODEL_OUTPUT_PRESENT).toBe(false);
    expect(malformed.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');

    const malformedModel = await mockRun(response(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not-json' }] } }] })));
    expect(malformedModel.report.FAILURE_REASON_CODE).toBe('RESPONSE_PARSE_ERROR');
    expect(malformedModel.report.FAILURE_STAGE).toBe('RESPONSE_PARSE');
    expect(malformedModel.report.MODEL_INFERENCE_SUCCEEDED).toBe(true);
    expect(malformedModel.report.MODEL_OUTPUT_PRESENT).toBe(true);
    expect(malformedModel.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');

    const invalid = await mockRun(response(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"NO","confidence":0.5}' }] } }] })));
    expect(invalid.report.FAILURE_REASON_CODE).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(invalid.report.FAILURE_STAGE).toBe('STRUCTURED_VALIDATION');
    expect(invalid.report.STRUCTURED_OUTPUT_PRESENT).toBe(false);
    expect(invalid.report.STRUCTURED_VALIDATION).toBe('FAIL');
    expect(invalid.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(invalid.report.PROVIDER_RESPONSE_RECEIVED).toBe(true);
    expect(invalid.report.MODEL_INFERENCE_SUCCEEDED).toBe(true);
    expect(invalid.report.MODEL_OUTPUT_PRESENT).toBe(true);
    expect(invalid.report.MODEL_OUTPUT_ACCEPTED).toBe(false);
  });

  it('secret-bearing synthetic errors cannot enter diagnostics, errors, attempts, report, or formatted console output', async () => {
    const run = await mockRun(response(500, JSON.stringify({ error: { message: certificationTestSecret, authorization: certificationTestSecret } })));
    expect(JSON.stringify(run.response?.execution)).not.toContain(certificationTestSecret);
    expect(JSON.stringify(run.response?.attempts)).not.toContain(certificationTestSecret);
    expect(JSON.stringify(run.response?.diagnostics)).not.toContain(certificationTestSecret);
    expect(JSON.stringify(run.response?.error)).not.toContain(certificationTestSecret);
    expect(JSON.stringify(run.report)).not.toContain(certificationTestSecret);
    expect(formatCertificationReport(run.report)).not.toContain(certificationTestSecret);
    expect(run.report.SECRET_LEAK_CHECK).toBe('PASS');
  });

  it('does not make a request when provider configuration is unsupported or incomplete', async () => {
    const transport = new MockTransport(() => response(200, '{}'));
    const unsupported = await runCertification({ provider: 'unsupported', model: 'model', credential: certificationTestSecret }, transport);
    expect(unsupported.report.CERTIFICATION_RESULT).toBe('FAIL');
    expect(unsupported.report.REQUEST_COUNT).toBe(0);
    const missing = await runCertification({ provider: 'gemini', model: 'model' }, transport);
    expect(missing.report.CERTIFICATION_RESULT).toBe('FAIL');
    expect(missing.report.CREDENTIAL_PRESENT).toBe('ABSENT');
    expect(missing.report.REQUEST_COUNT).toBe(0);
  });
});
