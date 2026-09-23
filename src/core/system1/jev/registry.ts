/**
 * Jev's registry entry (SYSTEM-1 directive §4). Jev is a real product — "Jev" by TypeSafe AI, a
 * "System-1" typed-decision model that returns floats for categories/yes-no/ratings/confidence
 * rather than generated text. Confirmed two independent ways: Laya's own `laya-typed-decisions`
 * model card directly benchmarks itself against "TypeSafe Jev 1.13.0 (published)", and separately
 * via internal Amazon AI-briefing pages (2026-09-17 to 2026-09-22).
 *
 * Access is invite-only early access; per the same briefings, requests were still pending as of
 * 2026-09-22, Jev is not available on AWS Bedrock, and no API key is obtainable in this environment.
 * Per the directive's own explicit rule (§4: "if unavailable, return UNAVAILABLE"), this is the
 * correct, honest status — not a shortfall, and not something a routing policy may paper over by
 * treating Laya as if it had a live second opinion when it does not (see `router/policy.ts`).
 */
export interface JevModelProfile {
  model_id: 'jev';
  provider: 'TypeSafe AI';
  checkpoint: string;
  runtime: string;
  status: 'UNAVAILABLE';
  known_limitations: string[];
}

export const JEV_PROFILE: JevModelProfile = {
  model_id: 'jev',
  provider: 'TypeSafe AI',
  checkpoint: "Jev 1.13.0 (version referenced third-party in Laya's own model card; TypeSafe AI "
    + 'publishes no public checkpoint identifier this research found)',
  runtime: 'TypeSafe AI hosted API (invite-only; not available on AWS Bedrock)',
  status: 'UNAVAILABLE',
  known_limitations: [
    'Access is invite-only early access; no API key is obtainable in this environment as of '
      + '2026-09-23. Reported pricing (~$0.042 per million tokens) is third-party, not independently verified.',
    'A real HTTP client exists in `client.ts` behind `JEV_API_KEY`, so the moment access arrives this '
      + 'entry upgrades to SHADOW/LIVE without a rewrite — but it fails closed today rather than '
      + 'simulating a response.',
  ],
};

export function findJevProfile(modelId: string): JevModelProfile | undefined {
  return modelId === 'jev' ? JEV_PROFILE : undefined;
}
