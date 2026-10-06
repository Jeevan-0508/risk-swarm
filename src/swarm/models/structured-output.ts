import { modelError, sanitizeDiagnostics } from './errors';
import { type OutputSchemaDescriptor, type SafeDiagnostics, type StructuredValidationDiagnostics } from './types';

export interface StructuredOutputPolicy {
  readonly allow_code_fence?: boolean;
  readonly allow_balanced_object_extraction?: boolean;
}

export interface StructuredOutputResult<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly error: ReturnType<typeof modelError> | null;
  readonly diagnostics: SafeDiagnostics;
}

function stripFence(text: string): string | null {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return match?.[1] ?? null;
}

function balancedCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') stack.push(character);
      if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (stack.length === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return [...new Set(candidates)];
}

export function parseJson(text: string, policy: StructuredOutputPolicy): { readonly value?: unknown; readonly error?: string; readonly mode: string; readonly candidate_count: number } {
  const fenced = policy.allow_code_fence ? stripFence(text) : null;
  const direct = fenced ?? text.trim();
  try {
    return { value: JSON.parse(direct), mode: fenced === null ? 'DIRECT_JSON' : 'CODE_FENCE_JSON', candidate_count: 0 };
  } catch {
    if (!policy.allow_balanced_object_extraction) return { error: 'invalid JSON', mode: 'INVALID_JSON', candidate_count: 0 };
    const candidates = balancedCandidates(text).filter((candidate) => {
      try { JSON.parse(candidate); return true; } catch { return false; }
    });
    if (candidates.length !== 1) return { error: candidates.length === 0 ? 'no bounded JSON object found' : 'multiple ambiguous JSON objects found', mode: 'AMBIGUOUS_JSON', candidate_count: candidates.length };
    return { value: JSON.parse(candidates[0]!), mode: 'BALANCED_JSON', candidate_count: candidates.length };
  }
}

export function normalizeStructuredOutput<T>(input: { readonly text?: string | null; readonly structured_output?: unknown }, schema: OutputSchemaDescriptor<T>, policy: StructuredOutputPolicy = {}): StructuredOutputResult<T> {
  let value = input.structured_output;
  let mode = 'PROVIDER_STRUCTURED';
  if (value === undefined || value === null) {
    if (!input.text || !input.text.trim()) return {
      ok: false,
      value: null,
      error: modelError('EMPTY_RESPONSE', 'RESPONSE_NORMALIZATION'),
      diagnostics: { text_present: false, provider_output_extracted: false, json_parse: 'NOT_RUN', schema_validation: 'NOT_RUN' },
    };
    const parsed = parseJson(input.text, policy);
    if (parsed.error) return {
      ok: false,
      value: null,
      error: modelError('RESPONSE_PARSE_ERROR', 'RESPONSE_PARSE', {
        parse_status: parsed.mode,
        provider_output_extracted: true,
        json_parse: 'FAIL',
        schema_validation: 'NOT_RUN',
        bounded_parse_strategy_attempted: policy.allow_balanced_object_extraction === true,
        json_candidate_count: parsed.candidate_count,
      }),
      diagnostics: { parse_status: parsed.mode, provider_output_extracted: true, json_parse: 'FAIL', schema_validation: 'NOT_RUN', bounded_parse_strategy_attempted: policy.allow_balanced_object_extraction === true, json_candidate_count: parsed.candidate_count },
    };
    value = parsed.value;
    mode = parsed.mode;
  }
  const checked = schema.validate(value);
  if (!checked.success) return {
    ok: false,
    value: null,
    error: modelError('STRUCTURED_OUTPUT_INVALID', 'STRUCTURED_VALIDATION', {
      schema: schema.name,
      validation: 'FAILED',
      mode,
      validation_reason: checked.error,
      provider_output_extracted: true,
      json_parse: 'PASS',
      schema_validation: 'FAIL',
      ...validationDiagnostics(checked.diagnostics),
    }),
    diagnostics: sanitizeDiagnostics({ schema: schema.name, validation: 'FAILED', mode, validation_reason: checked.error, provider_output_extracted: true, json_parse: 'PASS', schema_validation: 'FAIL', bounded_parse_strategy_attempted: mode === 'BALANCED_JSON', ...validationDiagnostics(checked.diagnostics) }),
  };
  return {
    ok: true,
    value: checked.value,
    error: null,
    diagnostics: sanitizeDiagnostics({ schema: schema.name, validation: 'PASSED', mode, provider_output_extracted: true, json_parse: 'PASS', schema_validation: 'PASS', bounded_parse_strategy_attempted: mode === 'BALANCED_JSON' }),
  };
}

function validationDiagnostics(value: StructuredValidationDiagnostics | undefined): SafeDiagnostics {
  if (!value) return {};
  return {
    VALIDATION_FAILURE_PATH: value.path,
    VALIDATION_FAILURE_CODE: value.code,
    VALIDATION_EXPECTED: value.expected,
    VALIDATION_ACTUAL_TYPE: value.actual_type,
  };
}

export function jsonSchema<T>(name: string, validate: (value: unknown) => { readonly success: true; readonly value: T } | { readonly success: false; readonly error: string; readonly diagnostics?: StructuredValidationDiagnostics }, options: { readonly strict?: boolean; readonly describe?: string; readonly json_schema?: Readonly<Record<string, unknown>> } = {}): OutputSchemaDescriptor<T> {
  return Object.freeze({ name, validate, ...options });
}
