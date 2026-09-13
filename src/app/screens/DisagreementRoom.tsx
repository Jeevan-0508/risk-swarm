/**
 * SCREEN 05 - DISAGREEMENT ROOM. Where the system shows its internal conflict instead of averaging it
 * away. The disagreement index and every term feeding it are printed as the scorer computed them.
 */
import { useState, type ReactNode } from 'react';
import type { Challenge } from '@core/domain/model';
import { useSession } from '@app/store/session';
import { AGENT_CODENAME, AGENT_LABEL } from '@app/lib/agents';
import { Bar, Empty, Metric, Panel, Row, SEVERITY_TONE, Tag, type Tone } from '@app/ui/kit';

const STATUS_TONE: Record<string, Tone> = {
  supported: 'support',
  partially_supported: 'caution',
  hypothesis_only: 'hypo',
  insufficient_evidence: 'objection',
};

const BASIS_LABEL: Record<Challenge['basis'], string> = {
  ungated_false_positive: 'ungated false positive',
  alternative_explanation: 'alternative explanation',
  evidence_deficiency: 'evidence deficiency',
};

export function DisagreementRoom() {
  const { active } = useSession();
  const result = active()?.result ?? null;
  const [basis, setBasis] = useState<Challenge['basis'] | 'all'>('all');

  if (result === null) {
    return (
      <Screen>
        <Panel title="disagreement"><Empty>No investigation loaded. Run one from the Command Center.</Empty></Panel>
      </Screen>
    );
  }

  const score = result.outputs.decision.score;
  const di = score.disagreement_index;
  const positions = result.outputs.decision.scoring_input.agent_positions;
  const challenges = result.outputs.challenger.findings;
  const shown = basis === 'all' ? challenges : challenges.filter((c) => c.basis === basis);
  const open = challenges.filter((c) => c.resolution === 'open');
  const blocking = challenges.filter((c) => c.severity === 'blocking');
  const decision = result.outputs.decision.decision;
  const statuses = new Set(positions.map((p) => p.reasoning_status));
  const confidences = positions.map((p) => p.confidence);
  const spread = confidences.length === 0 ? 0 : Math.max(...confidences) - Math.min(...confidences);

  return (
    <Screen>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="disagreement index" value={di.value.toFixed(1)} tone={di.value > 50 ? 'objection' : 'neutral'}
          sub="0 = the agents agree · 100 = the finding is contested throughout" />
        <Metric label="open challenges" value={open.length} sub={`of ${challenges.length} raised`} tone={open.length > 0 ? 'objection' : 'support'} />
        <Metric label="blocking" value={blocking.length} tone={blocking.length > 0 ? 'block' : 'support'} sub="severity that suppresses confidence" />
        <Metric label="distinct positions" value={statuses.size} sub={`confidence spread ${spread.toFixed(2)}`} />
      </div>

      <Panel title="how the index was computed" aside={<span className="num text-2xs text-fg-mute">{di.value.toFixed(1)} / 100</span>}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left">
              <th className="label pb-2">term</th>
              <th className="label pb-2 text-right">weight</th>
              <th className="label pb-2 text-right">normalised</th>
              <th className="label pb-2 text-right">contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {di.terms.map((t) => (
              <tr key={t.key}>
                <td className="py-2 pr-4 align-top">
                  <span className="num text-fg">{t.key}</span>
                  <span className="mt-0.5 block leading-snug text-fg-mute">{t.explanation}</span>
                </td>
                <td className="num py-2 text-right align-top text-fg-dim">{t.weight.toFixed(2)}</td>
                <td className="num py-2 text-right align-top text-fg-dim">{t.normalised.toFixed(3)}</td>
                <td className="num py-2 text-right align-top text-fg">{t.contribution.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="where each agent stood" aside={<span className="text-2xs text-fg-mute">positions are recorded before scoring, not reconciled after</span>} flush>
        <ul className="divide-y divide-line">
          {positions.map((p) => (
            <li key={p.agent} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <span className="w-64 shrink-0 truncate text-sm text-fg">
                {AGENT_CODENAME[p.agent as keyof typeof AGENT_CODENAME] !== undefined ? (
                  <>
                    <span className="font-mono">{AGENT_CODENAME[p.agent as keyof typeof AGENT_CODENAME]}</span>
                    <span className="text-fg-mute"> · {AGENT_LABEL[p.agent as keyof typeof AGENT_LABEL]}</span>
                  </>
                ) : (
                  p.agent
                )}
              </span>
              <Tag tone={STATUS_TONE[p.reasoning_status] ?? 'neutral'}>{p.reasoning_status.replace(/_/g, ' ')}</Tag>
              <div className="min-w-32 flex-1">
                <Bar value={p.confidence} tone={p.confidence >= 0.6 ? 'support' : p.confidence >= 0.35 ? 'caution' : 'objection'} />
              </div>
              <span className="num w-12 shrink-0 text-right text-xs text-fg-dim">{p.confidence.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`objections · ${shown.length}`} aside={
        <div className="flex gap-1.5">
          {(['all', 'ungated_false_positive', 'alternative_explanation', 'evidence_deficiency'] as const).map((b) => (
            <button key={b} onClick={() => setBasis(b)}
              className={`border px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.1em] ${
                basis === b ? 'border-line-bright text-fg' : 'border-line text-fg-mute'}`}>
              {b === 'all' ? 'all' : BASIS_LABEL[b]}
            </button>
          ))}
        </div>
      } flush>
        {shown.length === 0 ? <Empty>Nothing raised under this basis.</Empty> : (
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-2xs text-fg-mute">{c.id}</span>
                  <Tag tone={SEVERITY_TONE[c.severity.toUpperCase()] ?? 'caution'}>{c.severity}</Tag>
                  <Tag>{BASIS_LABEL[c.basis]}</Tag>
                  <Tag tone={c.resolution === 'rebutted' ? 'support' : 'objection'}>{c.resolution}</Tag>
                  <span className="num text-2xs text-fg-mute">against {c.target_id}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-fg-dim">{c.argument}</p>
                {c.alternative_explanation !== null && (
                  <div className="mt-2 divide-y divide-line border-l border-line-bright pl-3">
                    <Row k="benign reading" v={c.alternative_explanation} />
                  </div>
                )}
                {c.rebuttal !== null && (
                  <p className="mt-2 border-l border-support/50 pl-3 text-xs leading-relaxed text-support">rebutted: {c.rebuttal}</p>
                )}
                {c.evidence_ids.length > 0 && (
                  <p className="num mt-2 text-2xs text-fg-mute">evidence {c.evidence_ids.join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`objections carried into the recommendation · ${decision.unresolved_objections.length}`}>
        {decision.unresolved_objections.length === 0 ? (
          <Empty>Every objection was resolved before the recommendation was issued.</Empty>
        ) : (
          <ul className="space-y-2 text-sm leading-relaxed text-fg-dim">
            {decision.unresolved_objections.map((o, i) => (
              <li key={i} className="border-l border-objection/50 pl-3">{o}</li>
            ))}
          </ul>
        )}
      </Panel>
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Disagreement Room</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          Consensus is not evidence. This screen keeps the argument on the record: what each agent
          concluded, every objection raised against the lead hypothesis, the benign explanation that was
          not ruled out, and the exact arithmetic behind the disagreement index.
        </p>
      </div>
      {children}
    </div>
  );
}
