/**
 * The whole design system. One file on purpose: a shared vocabulary of eight primitives is what keeps
 * ten screens looking like one product, and it is easier to hold a rule than to police a folder.
 */
import type { ReactNode } from 'react';
import type { IntegrityStatus } from '@core/status';

export type Tone = 'neutral' | 'signal' | 'support' | 'caution' | 'objection' | 'block' | 'hypo';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg-dim',
  signal: 'text-signal',
  support: 'text-support',
  caution: 'text-caution',
  objection: 'text-objection',
  block: 'text-block',
  hypo: 'text-hypo',
};
const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-line-bright',
  signal: 'border-signal/50',
  support: 'border-support/50',
  caution: 'border-caution/50',
  objection: 'border-objection/50',
  block: 'border-block/60',
  hypo: 'border-hypo/50',
};
const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-fg-mute',
  signal: 'bg-signal',
  support: 'bg-support',
  caution: 'bg-caution',
  objection: 'bg-objection',
  block: 'bg-block',
  hypo: 'bg-hypo',
};

export function Panel({ title, aside, children, className = '', flush = false }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`hair bg-ink-800 ${className}`}>
      {title !== undefined && (
        <header className="flex items-baseline justify-between gap-4 hair-b px-4 py-2.5">
          <h2 className="label">{title}</h2>
          {aside}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Metric({ label, value, sub, tone = 'neutral', mono = true }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={`mt-1.5 truncate text-2xl font-light leading-none ${mono ? 'num' : ''} ${tone === 'neutral' ? 'text-fg' : TONE_TEXT[tone]}`}>{value}</div>
      {sub !== undefined && <div className="mt-1.5 text-xs leading-snug text-fg-mute">{sub}</div>}
    </div>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.1em] ${TONE_BORDER[tone]} ${TONE_TEXT[tone]}`}>{children}</span>;
}

export function Dot({ tone = 'neutral', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 ${TONE_BG[tone]} ${pulse ? 'animate-pulse' : ''}`} />;
}

export function Bar({ value, tone = 'signal', height = 'h-1' }: { value: number; tone?: Tone; height?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`w-full bg-ink-600 ${height}`}>
      <div className={`${height} ${TONE_BG[tone]} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled = false, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string;
}) {
  const styles = {
    primary: 'bg-fg text-ink-900 hover:bg-white',
    ghost: 'hair text-fg-dim hover:border-line-bright hover:text-fg',
    danger: 'border border-block/60 text-block hover:bg-block hover:text-ink-900',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`px-3.5 py-2 font-mono text-2xs uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint !== undefined && <span className="mt-1.5 block text-xs leading-snug text-fg-mute">{hint}</span>}
    </label>
  );
}

export const inputClass = 'mt-1.5 w-full bg-ink-700 hair px-3 py-2 text-sm text-fg placeholder:text-fg-mute focus:border-signal/60';

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-fg-mute">{children}</p>;
}

/** Definition row. Used everywhere a label/value pair appears, so alignment never drifts. */
export function Row({ k, v, tone = 'neutral' }: { k: string; v: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-start justify-between gap-6 py-1.5">
      <span className="label pt-0.5">{k}</span>
      <span className={`min-w-0 text-right text-sm ${tone === 'neutral' ? 'text-fg' : TONE_TEXT[tone]}`}>{v}</span>
    </div>
  );
}

export const BAND_TONE: Record<string, Tone> = { NOTE: 'neutral', MONITOR: 'caution', TARGETED_INVESTIGATION: 'signal', ESCALATE: 'block' };
export const SEVERITY_TONE: Record<string, Tone> = { LOW: 'neutral', MEDIUM: 'caution', HIGH: 'objection', CRITICAL: 'block' };
export const TIER_TONE: Record<number, Tone> = { 1: 'support', 2: 'signal', 3: 'caution', 4: 'hypo', 5: 'block' };
export const NODE_TONE: Record<string, Tone> = {
  evidence: 'support', signal: 'signal', observation: 'signal', hypothesis: 'hypo',
  challenge: 'objection', red_team_finding: 'block', decision: 'caution', action: 'neutral', outcome: 'neutral', lesson: 'neutral',
};
/** Shared by every VERIFIED/WARNING/BLOCKED reporter - SENTINEL, PULSE, and later ORBIT - so a fourth one has a map to reuse instead of defining its own. */
export const STATUS_TONE: Record<IntegrityStatus, Tone> = { VERIFIED: 'support', WARNING: 'caution', BLOCKED: 'block' };
