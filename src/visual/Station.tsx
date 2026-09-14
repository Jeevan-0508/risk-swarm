/**
 * AN AGENT STATION. One seat on the ring, or one row in the mobile stack - the same props either way, so
 * the two layouts cannot drift apart in what they claim.
 *
 * Everything shown is passed in from `stations()`: the state, the counts, the participation reason and
 * the last thing this seat actually said. The component derives nothing, which is why it is safe for it
 * to look expensive.
 */
import type { AgentId } from '../core/domain/model';
import { STATION_LABEL, type Station as StationData } from './stations';

export interface StationChrome {
  accent: string;
  codename: string;
  role: string;
}

function classes(station: StationData, active: boolean, addressed: boolean): string {
  return [
    'rs-station',
    station.spoke > 0 ? 'rs-station-spoken' : 'rs-station-quiet',
    station.state === 'STOOD_DOWN' ? 'rs-station-down' : '',
    addressed ? 'rs-station-addressed' : '',
    active ? 'rs-station-active' : '',
  ].filter(Boolean).join(' ');
}

/** The screen-reader sentence. Every station is readable without seeing a single mark. */
function described(station: StationData, chrome: StationChrome): string {
  const said = station.spoke === 1 ? '1 exchange' : `${station.spoke} exchanges`;
  const open = station.unresolved === 0 ? 'nothing open' : `${station.unresolved} open`;
  return `${chrome.codename}, ${chrome.role}. ${STATION_LABEL[station.state]}. ${said}, ${open}, ${station.evidence_cited} evidence cited. ${station.reason}`;
}

export function RingStation({ station, chrome, point, active, addressed, selected, onSelect }: {
  station: StationData;
  chrome: StationChrome;
  point: { x: number; y: number };
  active: boolean;
  addressed: boolean;
  selected: boolean;
  onSelect: (id: AgentId | null) => void;
}) {
  // Which way the card is laid out from its seat. A card is placed outward from the ring rather than
  // centred on it, so no station can ever land on top of the core no matter how large the core is.
  const side = point.x > 56 ? 'right' : point.x < 44 ? 'left' : point.y < 50 ? 'top' : 'bottom';
  return (
    <button
      type="button"
      onClick={() => onSelect(selected ? null : station.agent)}
      style={{ left: `${point.x}%`, top: `${point.y}%`, ['--rs-accent' as string]: chrome.accent }}
      className={`${classes(station, active, addressed)} rs-card rs-card-${side}`}
      aria-pressed={selected}
      aria-label={described(station, chrome)}
      title={station.reason}
    >
      <span className="rs-card-hub" aria-hidden="true">
        <span className="rs-node" />
      </span>
      <span className="rs-card-body">
        <span className="rs-card-name" style={{ color: chrome.accent }}>{chrome.codename}</span>
        <span className="rs-card-role">{chrome.role}</span>
        <span className="rs-card-state">
          <span className="rs-dot" aria-hidden="true" />
          {STATION_LABEL[station.state]}
        </span>
        <span className="num rs-card-count">{station.evidence_cited} evidence · {station.spoke} said</span>
        {station.unresolved > 0 && <span className="num rs-card-count">{station.unresolved} open</span>}
      </span>
    </button>
  );
}

/**
 * The ring, vertically. Below `sm` seven labels cannot sit on a circle legibly at any radius, so the same
 * seats and the same numbers are laid out as rows. A re-layout, never a reduction.
 */
export function StackStation({ station, chrome, active, addressed, selected, onSelect }: {
  station: StationData;
  chrome: StationChrome;
  active: boolean;
  addressed: boolean;
  selected: boolean;
  onSelect: (id: AgentId | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(selected ? null : station.agent)}
      style={{ ['--rs-accent' as string]: chrome.accent }}
      className={`${classes(station, active, addressed)} static flex w-full translate-x-0 translate-y-0 items-center gap-3 py-2`}
      aria-pressed={selected}
      aria-label={described(station, chrome)}
      title={station.reason}
    >
      <span className="rs-node" />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-2xs tracking-[0.16em]" style={{ color: chrome.accent }}>
          {chrome.codename}
        </span>
        <span className="block text-2xs text-fg-mute">{chrome.role}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-2xs uppercase tracking-[0.1em] text-fg-mute">
          {STATION_LABEL[station.state]}
        </span>
        <span className="num block text-2xs text-fg-mute">
          {station.spoke} said{station.unresolved > 0 ? ` · ${station.unresolved} open` : ''}
        </span>
      </span>
    </button>
  );
}
