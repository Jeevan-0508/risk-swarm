import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import { OLYMPIAN_AGENTS, PROVIDERS, type OlympianAgent, type ProviderId } from '@core/reasoner/registry';
import { agentLabel } from '@app/lib/models';
import { useModelStore } from '@app/store/models';

const DIVERSITY_TONE = { none: 'neutral', low: 'caution', moderate: 'signal', high: 'support' } as const;

function AgentRow({ agent }: { agent: OlympianAgent }) {
  const assignment = useModelStore((s) => s.assignments[agent]);
  const setAssignment = useModelStore((s) => s.setAssignment);
  const hasKey = useModelStore((s) => s.getApiKey(assignment.provider) !== null);

  return (
    <div className="border border-line bg-ink-800 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-fg">{agentLabel(agent)}</span>
        <label className="flex items-center gap-2 text-2xs text-fg-mute">
          <input type="checkbox" checked={assignment.enabled} onChange={(e) => setAssignment(agent, { enabled: e.target.checked })} />
          enabled
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="provider">
          <select value={assignment.provider} onChange={(e) => setAssignment(agent, { provider: e.target.value as ProviderId })} className={inputClass}>
            {Object.values(PROVIDERS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="model" hint="Any model string the provider accepts — this registry does not hard-code a model list.">
          <input value={assignment.model} onChange={(e) => setAssignment(agent, { model: e.target.value })} className={inputClass} />
        </Field>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Tag tone={hasKey ? 'support' : 'caution'}>{hasKey ? 'key configured' : 'no key — will use the deterministic fallback'}</Tag>
        <Tag tone="neutral">{PROVIDERS[assignment.provider].family}</Tag>
      </div>
    </div>
  );
}

function ProviderKeyField({ provider }: { provider: ProviderId }) {
  const meta = PROVIDERS[provider];
  const stored = useModelStore((s) => s.keys[provider] ?? '');
  const setKey = useModelStore((s) => s.setKey);
  const [value, setValue] = useState(stored);
  useEffect(() => setValue(stored), [stored]);

  return (
    <Field label={meta.label} hint={`Stored only in this browser's localStorage, sent only to ${meta.label}'s own API host, never to this site.`}>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => value !== stored && setKey(provider, value)}
          placeholder={stored ? '••••••••••••' : 'paste key here'}
          className={inputClass}
        />
        <a href={meta.key_help_url} target="_blank" rel="noreferrer" className="mt-1.5 shrink-0 self-start text-2xs text-signal underline">get a key</a>
      </div>
    </Field>
  );
}

export function ModelConfig() {
  const hydrate = useModelStore((s) => s.hydrate);
  const hydrated = useModelStore((s) => s.hydrated);
  const clearKeys = useModelStore((s) => s.clearKeys);
  /*
   * `diversity()` builds a fresh object every call. Selecting `(s) => s.diversity()` directly hands
   * `useSyncExternalStore` a snapshot that is never referentially equal to itself between the two reads
   * React does per render to check for tearing — React never stops re-rendering to reconcile the
   * "changed" state, and it throws "Maximum update depth exceeded" (React error #185) with no error
   * boundary anywhere in the tree to catch it, so the whole app unmounts blank. Select the stable
   * primitives (`assignments`, `keys`) and the stable method reference instead, and memoize the call
   * so it only recomputes when the state actually changed.
   */
  const assignments = useModelStore((s) => s.assignments);
  const keys = useModelStore((s) => s.keys);
  const diversityFn = useModelStore((s) => s.diversity);
  const diversity = useMemo(() => diversityFn(), [assignments, keys, diversityFn]);
  useEffect(() => { if (!hydrated) hydrate(); }, [hydrated, hydrate]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="kicker">EVOLUTION 6.0 · OLYMPIAN MODEL CONFIGURATION</div>
        <h1 className="mt-2 text-3xl font-light tracking-tight">Assign real models to the Council</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          RISK//SWARM is a static site with no server: every key below is used for a direct browser
          request to that provider's own API, from your own browser, and is never sent anywhere else —
          including to this site. It is stored only in this browser's <span className="num">localStorage</span>.
          Clearing your browser data, or the button below, removes it completely. An unconfigured or
          disabled agent always falls back to the existing deterministic, zero-network reasoning — the
          Council never breaks for lack of a key.
        </p>
      </div>

      <Panel title="provider keys" aside={<Button variant="danger" onClick={clearKeys}>clear all keys</Button>}>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.keys(PROVIDERS).map((p) => <ProviderKeyField key={p} provider={p as ProviderId} />)}
        </div>
      </Panel>

      <Panel title="agent assignment">
        <div className="grid gap-3 sm:grid-cols-2">
          {OLYMPIAN_AGENTS.map((agent) => <AgentRow key={agent} agent={agent} />)}
        </div>
      </Panel>

      <Panel title="model diversity" aside={<Tag tone={DIVERSITY_TONE[diversity.label]}>{diversity.label}</Tag>}>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Row k="active agents" v={<span className="num text-xs">{diversity.active_agents} / {OLYMPIAN_AGENTS.length}</span>} />
          <Row k="distinct providers" v={<span className="num text-xs">{diversity.providers}</span>} />
          <Row k="model families" v={<span className="num text-xs">{diversity.families.join(', ') || 'none'}</span>} />
        </div>
        <p className="mt-3 text-2xs leading-relaxed text-fg-mute">
          A real count over the current configuration, not a vanity metric: agents that are disabled or
          have no key for their provider are excluded. Spreading agents across providers avoids every
          Olympian sharing the same model's correlated blind spots.
        </p>
      </Panel>
    </div>
  );
}
