import { type Round1SeatId } from '../contracts';
import { RUNTIME_SEATS } from './definitions';
import { APOLLO_DEFINITION } from './apollo';
import { ARES_DEFINITION } from './ares';
import { ATHENA_DEFINITION } from './athena';
import { HADES_DEFINITION } from './hades';
import { type SeatDefinition } from './types';

export const SEAT_DEFINITIONS: Readonly<Record<Round1SeatId, SeatDefinition>> = Object.freeze({
  ATHENA: ATHENA_DEFINITION,
  ARES: ARES_DEFINITION,
  HADES: HADES_DEFINITION,
  APOLLO: APOLLO_DEFINITION,
});

export function seatDefinition(seatId: Round1SeatId): SeatDefinition {
  return SEAT_DEFINITIONS[seatId];
}

export function seatMandate(seatId: Round1SeatId): string {
  return RUNTIME_SEATS[seatId].mandate;
}
