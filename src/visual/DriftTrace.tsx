/**
 * EVOLUTION 5.0 Phase J. ORBIT's diff as two lanes.
 *
 * A scenario comparison is a before and an after, and the question a reader has is not "what are the
 * numbers" but "did anything I would act on move". So each field is one row: baseline on the left,
 * stressed on the right, a connector between them that is coloured only when the value changed, and a
 * material field drawn heavier than an informational one. The material set comes from ORBIT itself
 * (`MATERIAL_DIFF_KEYS`), so this chart cannot disagree with the `materially_changed` verdict beside it.
 *
 * The drift figure is a count over material fields, printed as the count as well as the fraction, because
 * "2 of 5" is checkable and "40%" invites being read as a confidence.
 */
import { driftModel, type DiffFieldLike } from './integrity';
import { SURFACE } from './tokens';

interface Props {
  fields: readonly DiffFieldLike[];
  materialKeys: readonly string[];
}

export function DriftTrace({ fields, materialKeys }: Props) {
  const model = driftModel(fields, materialKeys);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="label">baseline &rarr; stressed</div>
        <div className="num text-2xs text-fg-mute">
          {model.drift === null ? 'no material field compared' : `${model.material_changed}/${model.material_count} material fields moved`}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {model.lanes.map((lane) => (
          <div key={lane.key} className="grid grid-cols-[9rem_1fr_9rem] items-center gap-2">
            <div className={`truncate text-2xs ${lane.material ? 'text-fg' : 'text-fg-mute'}`} title={lane.label}>
              {lane.label}
            </div>
            <div className="flex items-center gap-2">
              <span className="num text-2xs text-fg-dim">{lane.baseline}</span>
              <svg className="h-3 flex-1" preserveAspectRatio="none" viewBox="0 0 100 12" aria-hidden="true">
                <line
                  x1={0}
                  y1={6}
                  x2={100}
                  y2={6}
                  stroke={lane.changed ? lane.accent : SURFACE.hair}
                  strokeWidth={lane.material ? 2 : 1}
                  strokeDasharray={lane.changed ? undefined : '3 4'}
                />
                {lane.changed && <circle cx={100} cy={6} r={3} fill={lane.accent} />}
              </svg>
              <span className="num text-2xs" style={{ color: lane.changed ? lane.accent : undefined }}>
                {lane.stressed}
              </span>
            </div>
            <div className="text-right text-2xs text-fg-mute">{lane.material ? 'material' : 'informational'}</div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-fg-dim">{model.note}</p>
    </div>
  );
}
