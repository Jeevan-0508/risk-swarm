# Security and trust boundaries

RISK//SWARM is designed to make unsupported confidence visible. Agents return schema-validated objects, provenance is checked before evidence can enter a result, and red-team findings can block a recommendation.

## Provider keys

The static application has no server-side secret store. User-entered provider keys are held in browser local storage and sent directly to the configured provider from the browser. Do not use this pattern as a production secret-management design.

## Evidence boundary

Retrieved text is untrusted input. It can be cited, challenged, or rejected, but it cannot grant an agent authority, lower a gate, or manufacture a source identity. The repository’s adversarial tests cover prompt-injection, fabricated citations, same-source repetition, and tier manipulation.

## Decision boundary

The system does not make an irreversible business decision for a user. High-risk, blocked, uncertain, fragile, or materially disputed cases route to review, more evidence, replay, or escalation according to the decision policy.

## Demo boundary

The hosted experience uses synthetic or captured fixtures. It is a portfolio demonstrator, not a production multi-agent control plane, security assessment, or guarantee of model reliability.
