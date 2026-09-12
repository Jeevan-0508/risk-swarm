import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from './loader.node';
import { createGovernanceMapper } from './governance';
import { createMemoryLoader } from './loader';

const gov = createGovernanceMapper(createFileLoader('public/snapshots'));

describe('governance mapper over the real control room model', () => {
  it('exposes the four frameworks and their cited requirements', async () => {
    const fws = await gov.frameworks();
    const reqs = await gov.requirements();
    expect(fws).toHaveLength(4);
    expect(reqs).toHaveLength(56);
    expect(reqs.every((r) => r.ref.length > 0 && r.framework_citation.length > 0)).toBe(true);
  });

  it('filters by framework and keyword', async () => {
    const euaia = await gov.requirements({ frameworks: ['EUAIA'] });
    expect(euaia.length).toBeGreaterThan(0);
    expect(euaia.every((r) => r.id.startsWith('EUAIA'))).toBe(true);
    const logging = await gov.requirements({ keywords: ['log'] });
    expect(logging.length).toBeGreaterThan(0);
  });

  it('cites the official instrument and labels the summary as a paraphrase', async () => {
    const c = await gov.cite('EUAIA-4');
    expect(c.citation).toContain('2024/1689');
    expect(c.url).toContain('eur-lex.europa.eu');
    expect(c.paraphrase_warning).toContain('not legal advice');
  });

  it('links controls to a requirement through the upstream satisfies mapping', async () => {
    const controls = await gov.controls('EUAIA-49');
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((c) => c.satisfies.includes('EUAIA-49'))).toBe(true);
  });

  it('allows established applicability only for a regulation with a resolvable citation', async () => {
    const imp = await gov.implication({ requirement_id: 'EUAIA-4', proposed_applicability: 'established', reasoning: 'Staff operate the system.' });
    expect(imp.applicability).toBe('established');
    expect(imp.control_ids.length).toBeGreaterThanOrEqual(0);
  });

  it('caps a standard to possible, because a standard is not an obligation', async () => {
    const iso = (await gov.requirements({ frameworks: ['ISO42001'] }))[0];
    const imp = await gov.implication({ requirement_id: iso.id, proposed_applicability: 'established', reasoning: 'Certification expected.' });
    expect(imp.applicability).toBe('possible');
    expect(imp.reasoning).toContain('capped');
  });

  it('forces not_established when no resolvable citation exists', async () => {
    const brokenLoader = createMemoryLoader(
      {
        'ai-governance-control-room/frameworks.json': {
          frameworks: [{ id: 'X', name: 'Mystery rules', citation: 'Somebody said so', url: 'not-a-url', kind: 'regulation', requirements: [{ id: 'X-1', ref: 'Art. 1', title: 'Thing', summary: 'Do the thing.' }] }],
        },
        'ai-governance-control-room/controls.json': { controls: [] },
      },
      { schema_version: '1.0', synced_at: '', synced_by: 'test', sources: [] },
    );
    const broken = createGovernanceMapper(brokenLoader);
    const imp = await broken.implication({ requirement_id: 'X-1', proposed_applicability: 'established', reasoning: 'Looks applicable.' });
    expect(imp.applicability).toBe('not_established');
    expect(imp.url).toBeNull();
  });

  it('refuses an unknown requirement id', async () => {
    await expect(gov.requirement('EUAIA-999')).rejects.toThrow(/UNKNOWN_REQUIREMENT/);
  });
});
