import { type ModelCapabilities, type ModelCapability, type ModelId } from './types';

export function missingCapabilities(actual: ModelCapabilities, required: readonly ModelCapability[]): readonly ModelCapability[] {
  return required.filter((capability) => !actual.capabilities.includes(capability));
}

export function supportsCapabilities(actual: ModelCapabilities, required: readonly ModelCapability[]): boolean {
  return missingCapabilities(actual, required).length === 0;
}

export function configuredTextCapabilities(model: ModelId): ModelCapabilities {
  void model;
  return Object.freeze({
    capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT', 'JSON_MODE'] as const,
    source: 'CONFIGURED',
    supports_system_instruction: true,
    supports_temperature: true,
  });
}

export function verifyCapabilities(actual: ModelCapabilities): ModelCapabilities {
  return Object.freeze({ ...actual, capabilities: [...actual.capabilities] });
}
