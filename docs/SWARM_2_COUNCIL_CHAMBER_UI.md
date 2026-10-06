# RISK//SWARM 2.0 — Council Chamber Visual Foundation

This document describes the Phase 6A visual foundation. It is a state-driven presentation of canonical SWARM state and events, not a second backend and not a claim of live certification.

## View-model boundary

`src/swarm/ui/view-model.ts` adapts `SwarmBlackboard` and `SwarmExecutionEvent[]` into one `CouncilViewModel`. The same adapter accepts live state later and persisted artifact replay now. It computes seat state, evidence references, disagreement links, challenge responses, revision lineage, protocol timeline, safe forensics, Zeus readiness, and the human-review boundary. It does not create events, infer model reasoning, invent nodes, or use timers for protocol state.

The stable five-seat layout is fixed: ATHENA north, ARES east, HADES south-east, APOLLO south-west, and ZEUS west. Zeus is dormant until the canonical readiness state permits synthesis. Open disagreement links remain visible after synthesis.

## Chamber

`CouncilChamber.tsx` provides reusable primitives for the dark chamber, five abstract seats, central Evidence Core, disagreement/challenge SVG relationships, protocol timeline, inspectors, Zeus synthesis panel, and the human boundary. Seat labels, state text, shape, and relationships accompany color so state is not color-only. The styling is CSS/SVG with no new rendering dependency and has a reduced-motion media boundary.

The Evidence Core reports case identity, sealed evidence count, open disagreement count, Apollo warnings/blockers, and protocol phase. Seats expose only structured position fields, safe execution status, evidence references, and revision history. No hidden reasoning or raw provider response is rendered.

## Graph and forensics foundations

`GraphView` exposes evidence-to-seat references and is intentionally backed only by evidence items and position citations present in the blackboard. `ForensicsView` exposes provider/model, execution status, and request IDs from sanitized execution metadata. Future graph layers can add claims, risks, controls, challenges, revisions, audit findings, and Zeus synthesis through the same adapter without fabricating nodes.

The timeline is event-driven and preserves sequence order. Allowed visual states include analysis, submitted/locked position, disagreement, challenge response, revision, audit complete, Zeus ready, synthesizing, and human review required. There are no fake thinking streams, fake conversations, or random activity.

## Inspectors and replay

Seat, evidence, and disagreement selection is designed as an accessible keyboard-operable boundary. The same panels can be fed from the durable Zeus artifact/replay projection. Future live and replay controls should differ only in their source adapter; they should not become two unrelated renderers.

## Accessibility, responsiveness, performance

The chamber uses semantic buttons and labels, visible focus states, text/state alongside color, responsive stacking below desktop widths, bounded timeline scrolling, and no uncontrolled animation loop. Reduced motion disables transitions and retains all state information as text.

## Future art direction

The current entities are abstract geometric/light identities. This is an upgradeable layout and component architecture, not final character art or an irreversible rendering choice. Three.js/WebGL was not added because the existing CSS/SVG layer is sufficient for the foundation and keeps the protocol state inspectable.
