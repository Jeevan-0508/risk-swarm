/**
 * SCREEN 11 - SCENARIO ROOM (ORBIT). Runs the reference investigation twice - once as published, once
 * under a named, deterministic stress - and shows what moved. It always stresses the same reference
 * scope (`DEMO_INPUT`) rather than an arbitrary past run: a stored run's `loader` is not serialisable,
 * so "re-run this exact investigation under stress" is a separate, bigger feature than this phase
 * scoped in (see `docs/EVOLUTION-2.0.md`, Phase D close-out).
 */
import { useState } from 'react';
import { DEMO_INPUT, runOptions } from '@app/lib/engine';
import { MATERIAL_DIFF_KEYS, runScenario, SCENARIOS, type OrbitReport, type ScenarioId } from '@core/orbit/orbit';
import { DriftTrace } from '../../visual/DriftTrace';
import { Button, Empty, Panel, Row, Tag } from '@app/ui/kit';
import { BAND_TONE, STATUS_TONE } from '@app/ui/kit';

const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function ScenarioRoom() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>(SCENARIO_IDS[0]);
  const [report, setReport] = useState<OrbitReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const options = runOptions(DEMO_INPUT, 'DEMO', 'RUN-DEMO', {});
      setReport(await runScenario(scenarioId, options));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Scenario Room</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
          Runs the reference investigation twice - as published, and under a deterministic stress - and
          diffs the two published outcomes. Nothing here edits a result by hand; a scenario can only
          change what the scout was given to find.
        </p>
      </div>

      <Panel title="pick a scenario">
        <div className="grid gap-2 md:grid-cols-2">
          {SCENARIO_IDS.map((id) => (
            <button key={id} onClick={() => setScenarioId(id)}
              className={`border px-3 py-2.5 text-left transition-colors ${scenarioId === id ? 'border-signal/60 bg-signal/10' : 'border-line hover:border-line-bright'}`}>
              <div className={`font-mono text-2xs uppercase tracking-[0.1em] ${scenarioId === id ? 'text-signal' : 'text-fg-dim'}`}>{SCENARIOS[id].label}</div>
              <div className="mt-1 text-2xs leading-snug text-fg-mute">{SCENARIOS[id].description}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 hair-t pt-3">
          <p className="text-xs leading-relaxed text-fg-mute">
            Stresses the reference DACH road-fraud investigation. Nothing is sent anywhere; this runs
            entirely against the pinned snapshot, in memory.
          </p>
          <Button onClick={run} disabled={running}>{running ? 'running both runs…' : 'run scenario'}</Button>
        </div>
      </Panel>

      {error !== null && (
        <Panel title="run failed">
          <p className="text-sm text-block">{error}</p>
        </Panel>
      )}

      {report !== null && (
        <>
          <Panel title="drift under stress" aside={<Tag tone={report.materially_changed ? 'objection' : 'support'}>{report.materially_changed ? 'materially changed' : 'held steady'}</Tag>}>
            <DriftTrace fields={report.fields} materialKeys={MATERIAL_DIFF_KEYS} />
          </Panel>

          <Panel title="what changed" aside={<Tag tone={report.materially_changed ? 'objection' : 'support'}>{report.materially_changed ? 'materially changed' : 'held steady'}</Tag>} flush>
            <ul className="divide-y divide-line">
              {report.fields.map((f) => (
                <li key={f.key} className="grid grid-cols-[10rem_1fr_1fr_3rem] items-baseline gap-3 px-4 py-2">
                  <span className="text-xs text-fg-mute">{f.label}</span>
                  <span className="num text-sm text-fg">{f.baseline}</span>
                  <span className={`num text-sm ${f.changed ? 'text-signal' : 'text-fg-dim'}`}>{f.stressed}</span>
                  <span>{f.changed ? <Tag tone="signal">moved</Tag> : <Tag tone="neutral">same</Tag>}</span>
                </li>
              ))}
            </ul>
            <div className="hair-t px-4 py-2.5 text-2xs uppercase tracking-[0.1em] text-fg-mute">baseline vs stressed</div>
          </Panel>

          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="baseline" aside={<Tag tone={BAND_TONE[report.baseline.outputs.decision.decision.action_band]}>{report.baseline.outputs.decision.decision.action_band}</Tag>}>
              <Row k="signals" v={report.baseline_signal_count} />
              <Row k="SENTINEL" v={<Tag tone={STATUS_TONE[report.baseline.sentinel.status]}>{report.baseline.sentinel.status}</Tag>} />
              <Row k="PULSE" v={<Tag tone={STATUS_TONE[report.baseline.pulse.status]}>{report.baseline.pulse.status}</Tag>} />
            </Panel>
            <Panel title="stressed" aside={<Tag tone={BAND_TONE[report.stressed.outputs.decision.decision.action_band]}>{report.stressed.outputs.decision.decision.action_band}</Tag>}>
              <Row k="signals" v={report.stressed_signal_count} />
              <Row k="SENTINEL" v={<Tag tone={STATUS_TONE[report.stressed.sentinel.status]}>{report.stressed.sentinel.status}</Tag>} />
              <Row k="PULSE" v={<Tag tone={STATUS_TONE[report.stressed.pulse.status]}>{report.stressed.pulse.status}</Tag>} />
            </Panel>
          </div>
        </>
      )}

      {report === null && error === null && !running && <Empty>Pick a scenario and run it to see the diff.</Empty>}
    </div>
  );
}
