/**
 * SCREEN 14 - KNOWLEDGE DELTA. The human decision gate on the taxonomy itself.
 *
 * EVOLUTION 5.0 Phase I. `core/knowledge/delta.ts` and `core/knowledge/approval.ts` have existed and been
 * tested since EVOLUTION 4.0 with no way for a human to reach them, which meant the one workflow in this
 * system that is defined as requiring a named person had no person in it. This screen is that person's
 * seat, and it is deliberately thin: every rule it appears to enforce is enforced in the core module, and
 * this file only shows the answer and collects a name and a reason.
 *
 * The honest part is what approval does NOT do. `approveProposal` returns a NEW pack; the pinned snapshot
 * on disk is untouched, and this screen has no write path to it. So an approval here changes the taxonomy
 * for this browser session only. Saying that plainly, and handing back the rule as copyable JSON for a
 * human to commit, is the whole point - an approval screen that implied it had edited canonical knowledge
 * would be manufacturing an authority the deployment does not have.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Empty, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import { loadLedger, proposalFor, recordDecision, saveLedger, type LedgerState } from '@app/lib/ledger';
import type { KnowledgeDelta as Delta, KnowledgeDeltaStatus } from '@core/knowledge/delta';
import {
  ApprovalRefused,
  MIN_DISTINCT_SOURCES,
  approveProposal,
  proposeTaxonomyChange,
  rejectProposal,
  validateProposal,
} from '@core/knowledge/approval';
import { PACKS, packById } from '@core/packs/registry';
import type { KnowledgePack } from '@core/packs/types';

const PACK_IDS = Object.keys(PACKS);

const STATUS_TONE: Record<KnowledgeDeltaStatus, 'signal' | 'support' | 'objection'> = {
  proposed: 'signal',
  approved: 'support',
  rejected: 'objection',
};

/** The rule an approval appended, in the tuple shape `packs/*.ts` already stores it. */
const ruleJson = (pack: KnowledgePack): string => {
  const rule = pack.category_rules[pack.category_rules.length - 1];
  return rule === undefined ? '[]' : JSON.stringify(rule, null, 2);
};

export function KnowledgeDelta() {
  const [state, setState] = useState<LedgerState>(() => loadLedger());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetPackId, setTargetPackId] = useState<string>(PACK_IDS[0] ?? 'freight-risk');
  const [approver, setApprover] = useState('');
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<string[]>([]);
  const [approvedPack, setApprovedPack] = useState<KnowledgePack | null>(null);

  const commit = (next: LedgerState) => {
    saveLedger(next);
    setState(next);
  };

  const entries = state.ledger.entries;
  const selected: Delta | null = useMemo(
    () => entries.find((d) => d.id === selectedId) ?? null,
    [entries, selectedId],
  );
  const decided = selected === null ? null : proposalFor(state, selected.id);

  const pack = useMemo(() => packById(targetPackId), [targetPackId]);
  const proposal = useMemo(
    () => (selected === null ? null : (decided ?? proposeTaxonomyChange(selected, pack, new Date().toISOString()))),
    [selected, decided, pack],
  );
  const validation = useMemo(
    () => (proposal === null ? null : validateProposal(proposal, pack)),
    [proposal, pack],
  );

  const canDecide = proposal !== null && proposal.status === 'proposed';

  const onApprove = () => {
    if (proposal === null) return;
    setRefusal([]);
    try {
      const result = approveProposal(proposal, pack, {
        by: approver,
        now: new Date().toISOString(),
        note,
      });
      setApprovedPack(result.pack);
      commit(recordDecision(state, result.proposal));
    } catch (error) {
      setApprovedPack(null);
      setRefusal(error instanceof ApprovalRefused ? error.reasons : [String(error)]);
    }
  };

  const onReject = () => {
    if (proposal === null) return;
    setRefusal([]);
    try {
      const rejected = rejectProposal(proposal, { by: approver, now: new Date().toISOString(), note });
      setApprovedPack(null);
      commit(recordDecision(state, rejected));
    } catch (error) {
      setRefusal(error instanceof ApprovalRefused ? error.reasons : [String(error)]);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Knowledge Delta</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
          The human decision gate on the taxonomy. Research proposes; nobody but a named person disposes.
        </p>
      </div>

      <Panel title="the taxonomy gate" aside={`${entries.length} delta(s) on the ledger`}>
        <p className="text-2xs text-fg-dim leading-relaxed">
          A research pass can propose that a question belongs to a category the canonical taxonomy does not
          have yet. That proposal is a <span className="text-fg">KnowledgeDelta</span>, and it is not
          knowledge: it changes nothing until a named person approves it here. Approval requires at least{' '}
          {MIN_DISTINCT_SOURCES} distinct sources, because one source repeated is the same claim twice.
        </p>
        <p className="text-2xs text-caution leading-relaxed mt-2">
          An approval on this screen builds a new pack in memory for this session. It does not write to the
          pinned snapshot under <span className="num">public/snapshots</span> - this app is static and has
          nowhere to write. The approved rule is printed below as JSON so a human can commit it.
        </p>
      </Panel>

      <Panel title="the ledger" aside="append-only">
        {entries.length === 0 ? (
          <Empty>
            No deltas have been proposed. Run a pass on <Link className="text-signal" to="/research">Research</Link>{' '}
            and, if its plan expected a knowledge update, add the result to the ledger from there.
          </Empty>
        ) : (
          <div className="space-y-2">
            {entries.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setSelectedId(d.id);
                  setRefusal([]);
                  setApprovedPack(null);
                }}
                className={`w-full text-left hair p-3 transition-colors ${
                  d.id === selectedId ? 'bg-ink-700 border-line-bright' : 'bg-ink-800 hover:bg-ink-700'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num text-2xs text-fg-mute">{d.id}</span>
                  <Tag tone={STATUS_TONE[d.status]}>{d.status}</Tag>
                </div>
                <div className="text-xs text-fg mt-1">{d.question}</div>
                <div className="text-2xs text-fg-dim mt-1">
                  {d.domain}
                  {d.subdomains.length > 0 ? ` / ${d.subdomains.join(', ')}` : ''} - {d.evidence_count} item(s),{' '}
                  {d.distinct_source_count} source(s)
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {selected !== null && (
        <>
          <Panel title="what is being proposed" aside={selected.id}>
            <Row k="question" v={selected.question} />
            <Row k="domain" v={selected.domain} />
            <Row k="subdomains" v={selected.subdomains.length > 0 ? selected.subdomains.join(', ') : 'none named'} />
            <Row k="keywords" v={selected.keywords.length > 0 ? selected.keywords.join(', ') : 'none'} />
            <Row k="evidence items" v={String(selected.evidence_count)} />
            <Row
              k="distinct sources"
              v={String(selected.distinct_source_count)}
              tone={selected.distinct_source_count < MIN_DISTINCT_SOURCES ? 'objection' : 'support'}
            />
            <Row k="run" v={selected.run_id} />
            <Row k="proposed at" v={selected.proposed_at} />
            <p className="text-2xs text-fg-dim leading-relaxed mt-2">{selected.rationale}</p>
            {selected.evidence_ids.length > 0 && (
              <p className="text-2xs text-fg-mute num leading-relaxed mt-2">{selected.evidence_ids.join('  ')}</p>
            )}
          </Panel>

          <Panel title="against which pack" aside={proposal === null ? undefined : proposal.id}>
            <Field label="target pack" hint="the proposal is validated against this pack's existing categories">
              <div className="flex flex-wrap gap-2">
                {PACK_IDS.map((id) => (
                  <Button
                    key={id}
                    variant={id === targetPackId ? 'primary' : 'ghost'}
                    disabled={decided !== null}
                    onClick={() => {
                      setTargetPackId(id);
                      setRefusal([]);
                      setApprovedPack(null);
                    }}
                  >
                    {packById(id).label}
                  </Button>
                ))}
              </div>
            </Field>
            {proposal !== null && (
              <>
                <Row k="would add category" v={proposal.category} />
                <Row k="with terms" v={proposal.terms.length > 0 ? proposal.terms.join(', ') : 'none'} />
                <Row k="pack already has" v={`${pack.category_rules.length} category rule(s)`} />
              </>
            )}
          </Panel>

          <Panel
            title="validation"
            aside={validation === null ? undefined : validation.ok ? 'passes' : `${validation.failures.length} failure(s)`}
          >
            {validation === null ? (
              <Empty>Nothing selected.</Empty>
            ) : validation.ok ? (
              <p className="text-2xs text-support leading-relaxed">
                Every gate passes. Approval is still a human act - it needs a name and a note below.
              </p>
            ) : (
              <ul className="space-y-2">
                {validation.failures.map((f) => (
                  <li key={f} className="text-2xs text-objection leading-relaxed">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="decision" aside={decided === null ? 'undecided' : decided.status}>
            {decided !== null ? (
              <>
                <Row k="status" v={decided.status} tone={decided.status === 'approved' ? 'support' : 'objection'} />
                <Row k="decided by" v={decided.decided_by ?? 'unnamed'} />
                <Row k="decided at" v={decided.decided_at ?? 'unknown'} />
                <Row k="note" v={decided.note ?? 'none'} />
                <p className="text-2xs text-fg-dim leading-relaxed mt-2">
                  A decision is not revisited. Re-validating a decided proposal fails on purpose.
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <Field label="approver" hint="canonical knowledge is not changed anonymously">
                  <input
                    className={inputClass}
                    value={approver}
                    onChange={(e) => setApprover(e.target.value)}
                    placeholder="who is deciding"
                  />
                </Field>
                <Field label="note" hint="required to reject; recorded either way">
                  <input
                    className={inputClass}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="why this is or is not knowledge"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={onApprove}
                    disabled={!canDecide || validation === null || !validation.ok || approver.trim().length === 0}
                  >
                    approve and extend the pack
                  </Button>
                  <Button variant="ghost" onClick={onReject} disabled={!canDecide}>
                    reject
                  </Button>
                </div>
                {refusal.length > 0 && (
                  <ul className="space-y-2">
                    {refusal.map((r) => (
                      <li key={r} className="text-2xs text-objection leading-relaxed">
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Panel>

          {approvedPack !== null && (
            <Panel title="the new pack" aside={`${approvedPack.category_rules.length} category rule(s)`}>
              <p className="text-2xs text-fg-dim leading-relaxed">
                This is a new object. The pack that was validated against is unchanged, and the snapshot on
                disk is unchanged. To make this permanent, add the entry below to{' '}
                <span className="num">category_rules</span> in the pack's source file and commit it.
              </p>
              <pre className="hair bg-ink-900 p-3 mt-2 text-2xs text-fg num overflow-x-auto">
                {ruleJson(approvedPack)}
              </pre>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
