import { emptySwarmBlackboard } from '../engine/reducer';
import { CouncilChamber } from './CouncilChamber';

/** Honest integration shell: until a SWARM artifact is selected, the chamber
 * renders an idle five-seat geometry rather than inventing a demonstration run. */
export default function SwarmCouncilPage() {
  return <CouncilChamber state={emptySwarmBlackboard()} events={[]} mode="REPLAY" />;
}
