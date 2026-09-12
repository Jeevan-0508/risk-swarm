import { IdFactory } from './ids';
import {
  Action,
  Challenge,
  Decision,
  Evidence,
  Hypothesis,
  Lesson,
  Observation,
  Outcome,
  RedTeamFinding,
  Signal,
  TIER_OF_SOURCE_TYPE,
  type Author,
  type NodeKind,
} from './model';

export type Clock = () => string;
export const fixedClock = (iso: string): Clock => () => iso;

type Without<T> = Omit<T, 'id' | 'kind' | 'created_at' | 'created_by' | 'run_id' | 'supersedes' | 'tier'> & {
  id?: string;
  supersedes?: string | null;
};

/**
 * Creates validated domain nodes. Nodes are returned, not inserted: the orchestrator inserts them
 * only after provenance validation, so an agent can never write straight into shared memory.
 */
export class Minter {
  constructor(
    readonly run_id: string,
    private readonly clock: Clock,
    private readonly ids: IdFactory = new IdFactory(),
  ) {}

  private base(kind: NodeKind, by: Author, id?: string, supersedes?: string | null) {
    return {
      id: id ?? this.ids.next(kind),
      kind,
      created_at: this.clock(),
      created_by: by,
      run_id: this.run_id,
      supersedes: supersedes ?? null,
    };
  }

  /** Tier is derived from source_type, never supplied by the caller. */
  evidence(by: Author, input: Without<Evidence>): Evidence {
    const { id, supersedes, ...rest } = input;
    return Evidence.parse({
      ...this.base('evidence', by, id, supersedes),
      ...rest,
      tier: TIER_OF_SOURCE_TYPE[rest.source_type],
    });
  }

  signal(by: Author, input: Without<Signal>): Signal {
    const { id, supersedes, ...rest } = input;
    return Signal.parse({ ...this.base('signal', by, id, supersedes), ...rest });
  }

  observation(by: Author, input: Without<Observation>): Observation {
    const { id, supersedes, ...rest } = input;
    return Observation.parse({ ...this.base('observation', by, id, supersedes), ...rest });
  }

  hypothesis(by: Author, input: Without<Hypothesis>): Hypothesis {
    const { id, supersedes, ...rest } = input;
    return Hypothesis.parse({ ...this.base('hypothesis', by, id, supersedes), ...rest });
  }

  challenge(by: Author, input: Without<Challenge>): Challenge {
    const { id, supersedes, ...rest } = input;
    return Challenge.parse({ ...this.base('challenge', by, id, supersedes), ...rest });
  }

  redTeamFinding(by: Author, input: Without<RedTeamFinding>): RedTeamFinding {
    const { id, supersedes, ...rest } = input;
    return RedTeamFinding.parse({ ...this.base('red_team_finding', by, id, supersedes), ...rest });
  }

  decision(by: Author, input: Without<Decision>): Decision {
    const { id, supersedes, ...rest } = input;
    return Decision.parse({ ...this.base('decision', by, id, supersedes), ...rest });
  }

  action(by: Author, input: Without<Action>): Action {
    const { id, supersedes, ...rest } = input;
    return Action.parse({ ...this.base('action', by, id, supersedes), ...rest });
  }

  outcome(by: Author, input: Without<Outcome>): Outcome {
    const { id, supersedes, ...rest } = input;
    return Outcome.parse({ ...this.base('outcome', by, id, supersedes), ...rest });
  }

  lesson(by: Author, input: Without<Lesson>): Lesson {
    const { id, supersedes, ...rest } = input;
    return Lesson.parse({ ...this.base('lesson', by, id, supersedes), ...rest });
  }
}
