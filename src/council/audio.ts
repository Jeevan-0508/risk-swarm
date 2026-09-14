/**
 * THE COUNCIL's sound. Written from oscillators, not sampled from anything: seven pitches on one
 * pentatonic set (so any order of speakers is consonant and no sequence can sound like a wrong note),
 * one waveform and one envelope per event register.
 *
 * Two rules it exists under:
 *
 * 1. **Silence is the default, and the toggle is real.** Nothing plays until a human turns it on, and
 *    `setEnabled(false)` stops the context rather than muting a running one.
 * 2. **Sound carries no information that is not also on screen.** Every event's speaker, type, status
 *    and words are rendered as text; the tone is a texture over that, so a deaf reader, a muted tab and
 *    a screenshot all lose nothing. This is the same rule the showcase already holds for motion.
 *
 * `noteFor()` is a pure function so the whole composition is testable with no AudioContext, no browser
 * and no timing: the audible part below it is a thin adapter with no decisions of its own.
 */
import type { DeliberationEvent } from '../core/domain/model';
import { AGENT_ORDER } from '../app/lib/agents';
import { EVENT_TONE, type EventTone } from './derive';

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface Note {
  /** Hertz. Derived from the speaker's seat, so a voice is recognisable before the label is read. */
  freq: number;
  wave: Wave;
  durationMs: number;
  /** Peak gain, 0-1. Deliberately low: this is a texture under a reading task, not a soundtrack. */
  gain: number;
}

/**
 * A minor pentatonic set rooted on G3, one degree per seat in pipeline order. Pentatonic because every
 * pair in the set is consonant: the council can speak in any order, twice as fast, or all at once at the
 * end of a round, and the result cannot land on a dissonance that would read as an error.
 */
const SEAT_HZ: number[] = [196.0, 233.08, 261.63, 293.66, 349.23, 392.0, 466.16];

/** One register per event tone. Sharper waveforms for adversarial registers, softer for agreement. */
const TONE_VOICE: Record<EventTone, { wave: Wave; durationMs: number; gain: number }> = {
  ask: { wave: 'triangle', durationMs: 180, gain: 0.05 },
  state: { wave: 'sine', durationMs: 150, gain: 0.04 },
  attack: { wave: 'sawtooth', durationMs: 130, gain: 0.055 },
  defend: { wave: 'square', durationMs: 140, gain: 0.04 },
  agree: { wave: 'sine', durationMs: 260, gain: 0.05 },
  revise: { wave: 'triangle', durationMs: 220, gain: 0.045 },
  escalate: { wave: 'sawtooth', durationMs: 320, gain: 0.06 },
  close: { wave: 'sine', durationMs: 620, gain: 0.055 },
};

export function noteFor(event: DeliberationEvent): Note {
  const seat = AGENT_ORDER.indexOf(event.from_agent);
  const voice = TONE_VOICE[EVENT_TONE[event.type]];
  // An unresolved exchange sits a whole tone lower than the same exchange resolved. It is the one
  // audible distinction that maps onto something evidential, and it is also printed beside the event.
  const detune = event.status === 'unresolved' ? 0.891 : 1;
  return { freq: SEAT_HZ[seat < 0 ? 0 : seat] * detune, wave: voice.wave, durationMs: voice.durationMs, gain: voice.gain };
}

export interface CouncilAudio {
  play: (event: DeliberationEvent) => void;
  dispose: () => void;
}

/**
 * The audible adapter. Created only once a human has switched sound on, and `dispose()` closes the
 * context rather than leaving a silent one running. Returns a no-op implementation where Web Audio does
 * not exist, so a missing API is a quiet page and never a crash.
 */
export function createCouncilAudio(): CouncilAudio {
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return { play: () => {}, dispose: () => {} };

  const ctx = new Ctor();
  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(ctx.destination);

  return {
    play(event) {
      if (ctx.state === 'suspended') void ctx.resume();
      const note = noteFor(event);
      const now = ctx.currentTime;
      const seconds = note.durationMs / 1000;

      const osc = ctx.createOscillator();
      osc.type = note.wave;
      osc.frequency.setValueAtTime(note.freq, now);

      // A short attack and an exponential decay to near-zero: struck, not swelled, so a fast replay
      // stays legible instead of turning into a drone.
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(note.gain, now + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

      osc.connect(env);
      env.connect(bus);
      osc.start(now);
      osc.stop(now + seconds + 0.02);
    },
    dispose() {
      void ctx.close();
    },
  };
}
