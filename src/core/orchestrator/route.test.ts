import { describe, expect, it } from '../test/bdd';
import { freightPack, openPack } from '../packs/registry';
import { routeToPipeline } from './route';

describe('routing a question to a pipeline', () => {
  it('sends a pack with a pinned taxonomy to investigation', () => {
    const d = routeToPipeline(freightPack());
    expect(d.route).toBe('investigation');
  });

  it('sends the open pack to research rather than an investigation the scout cannot serve', () => {
    const d = routeToPipeline(openPack());
    expect(d.route).toBe('research');
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
