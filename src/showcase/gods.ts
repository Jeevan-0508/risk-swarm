/**
 * The pantheon's character sheet. Data, not markup, so the page stays a renderer over it.
 *
 * Every `mechanism` line is a real property of the agent it describes - the myth is the framing, the
 * sentence underneath it is the actual behaviour in `src/core/agents`. If an agent's contract changes,
 * this file is wrong and must change with it; that is deliberate, and better than prose that drifts.
 */

export interface God {
  /** Technical agent id, unchanged from the engine's own vocabulary. */
  agent: string;
  god: string;
  domain: string;
  symbol: string;
  /** One accent colour per god. Kept off the console's semantic palette on purpose. */
  accent: string;
  pose: string;
  /** Mythic voice. */
  blurb: string;
  /** Precise voice: what the agent actually does, no metaphor. */
  mechanism: string;
  /** What the scroll-triggered beat shows, and why that beat and not a prettier one. */
  beat: string;
}

export const PANTHEON: God[] = [
  {
    agent: 'SCOUT',
    god: 'Hermes',
    domain: 'discovery',
    symbol: 'winged sandal',
    accent: '#7fd4e8',
    pose: 'mid-stride, never seated, carrying what he found and nothing he was told to find',
    blurb: 'He goes out and comes back. He does not decide what it means, and he will not carry a rumour he cannot point to.',
    mechanism: 'Retrieves signals from the pinned snapshot or live feeds. A signal with no verifiable url is dropped, not downgraded - an unverifiable signal is not weaker evidence, it is not evidence. Publishes its own exclusion counts so a wrong exclusion is visible instead of silent.',
    beat: 'Signals drift in from the edges. Two fade out mid-flight: no url, so they never entered the record.',
  },
  {
    agent: 'INTELLIGENCE',
    god: 'Athena',
    domain: 'pattern',
    symbol: 'owl',
    accent: '#9ec3ff',
    pose: 'still, weighing two things that look identical and refusing to say they are',
    blurb: 'Wisdom here is restraint: she merges what is the same event and publishes her doubt about the rest.',
    mechanism: 'Deterministic clustering by word-trigram and content-token similarity, no model. Pairs too similar to ignore but not similar enough to merge are published as possible duplicates rather than merged - silently merging destroys real corroboration, and quietly inflates the independent-source count.',
    beat: 'The signals pull into clusters. Two clusters stay linked by a dashed line: too close to ignore, not close enough to merge, so the doubt is shown instead of resolved.',
  },
  {
    agent: 'RISK ANALYST',
    god: 'Apollo',
    domain: 'hypothesis',
    symbol: 'sun disc and bow',
    accent: '#ffc76b',
    pose: 'bow drawn at his own claim, not at the target',
    blurb: 'He states what he thinks is happening and, in the same breath, what would prove him wrong.',
    mechanism: 'Forms hypotheses against the fraud taxonomy and attaches a named falsification test to each one. Indicator coverage is weight assessed over weight total - coverage, never probability - and an indicator nobody has looked at is recorded as unknown, never as absent.',
    beat: 'A target ring closes over the largest cluster, with the falsification test marked on it. A hairline crack is already drawn in: the claim ships pre-cracked.',
  },
  {
    agent: 'GOVERNANCE OFFICER',
    god: 'Zeus',
    domain: 'rule',
    symbol: 'bolt as citation mark',
    accent: '#c9b6ff',
    pose: 'bolt held low, ruling only on what he can cite',
    blurb: 'He rules loudly where the law is written down and says nothing at all where it is not.',
    mechanism: 'Maps the finding onto real regulatory hooks from the pinned governance snapshot. Each implication is marked established or not established, and an implication with no citation is published as unestablished rather than asserted - the bolt only lands where a citation exists.',
    beat: 'The bolt strikes and becomes a bracket clamping the cited half of the ring. The uncited half stays open and dim - not condemned, just not claimed.',
  },
  {
    agent: 'CHALLENGER',
    god: 'Ares',
    domain: 'objection',
    symbol: 'spear and dented shield',
    accent: '#ff9f7a',
    pose: 'shield already dented, because he has been wrong before and it is on the record',
    blurb: 'He is not allowed to just disagree. He has to say what else would explain this.',
    mechanism: 'Files objections against the analyst\'s findings, and every objection must name an alternative explanation - a bare "I doubt it" is not a finding. Objections are published in the brief unresolved rather than averaged into the score.',
    beat: 'The spear taps the crack and it widens, and a second ring is drawn alongside: the alternative explanation, named, standing next to the first.',
  },
  {
    agent: 'RED TEAM',
    god: 'Hades',
    domain: 'veto',
    symbol: 'helm held, not worn',
    accent: '#ff7d94',
    pose: 'helm in hand at his side - the power to disappear, declined',
    blurb: 'He can shut a door. He cannot open one. That asymmetry is the whole design.',
    mechanism: 'Runs fabrication, circularity and false-positive checks over the decision chain. A fail can force rework or cap the recommendation band; nothing it produces can raise a band. It can stop an escalation and can never create one.',
    beat: 'A gate drops across an ESCALATE chevron and stamps it back down a band. The gate has no mechanism for lifting.',
  },
  {
    agent: 'DECISION ENGINE',
    god: 'Hephaestus',
    domain: 'assembly',
    symbol: 'hammer and anvil',
    accent: '#e8d6a8',
    pose: 'working, not deliberating - the argument happened upstream',
    blurb: 'He does not have opinions. He has a calculator, a template, and everyone else\'s output.',
    mechanism: 'Assembles the brief from the other six: score, band, urgency, owner, review date, named countermeasures. Every cap and every failed escalation gate is printed by name, and confidence is withheld outright when the evidence cannot carry it rather than estimated.',
    beat: 'Hammer meets anvil and the sparks resolve into a sealed brief - stamped with the band from the last run actually stored in this browser, or with nothing at all if there is not one.',
  },
];
