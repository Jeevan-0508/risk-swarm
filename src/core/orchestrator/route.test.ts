import { describe, expect, it } from '../test/bdd';
import { freightPack, openPack } from '../packs/registry';
import { routeToPipeline } from './route';

describe('routing a question to a pipeline', () => {
  it('sends a pack with a pinned taxonomy to investigation', () => {
    const d = routeToPipeline('Are we exposed to phantom-carrier fraud in Germany?', freightPack());
    expect(d.route).toBe('investigation');
  });

  it('sends the open pack to research rather than an investigation the scout cannot serve', () => {
    const d = routeToPipeline('What is the largest planet in the solar system?', openPack());
    expect(d.route).toBe('research');
    expect(d.reason.length).toBeGreaterThan(0);
  });

  it('routes an otherwise general question away from freight even when a freight pack is supplied', () => {
    const d = routeToPipeline('What is the largest planet in the solar system?', freightPack());
    expect(d.route).toBe('research');
  });

  it('allows only an explicit operator pack override to select the freight pipeline', () => {
    const d = routeToPipeline('What is the largest planet in the solar system?', freightPack(), { explicitPackOverride: true });
    expect(d.route).toBe('investigation');
  });
});
