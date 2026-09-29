# SWARM research capture v1

`contracts/swarm-research-capture.v1.schema.json` defines a manual JSON handoff from the browser-based SWARM research pass to a later Risk Replay review. The Research screen downloads the file locally; it does not upload or POST it anywhere.

The capture contains the operator-supplied question, retrieval attempts and status, normalized externally retrieved source records, and dropped-source reasons. It deliberately excludes SWARM's derived answer, Council/model output, internal knowledge text, and knowledge proposals. A source record preserves what a provider returned. Its presence does not establish that the content is authentic, true, independent, or entailed by a later claim.

An imported Fraud Watch candidate is optional and lives only under `hypothesis_context`. That object is fixed to `data_class: synthetic_simulation`, `role: hypothesis_context_only`, and `authenticity: unverified_export`; it is structurally separate from `research.source_records`. A candidate's simulator labels, case IDs, taxonomy resemblance, and correlation index cannot be counted as sourced evidence or a validated outcome.

The source revision is null because the deployed static browser build does not embed a verifiable Git revision. Internal search status and hit count are retained, but its content is not copied into this portable artifact. `content_hash` records a fingerprint over normalized excerpt text (or title); the browser may use SHA-256 or a non-cryptographic FNV-1a fallback. Neither fingerprint type proves source authenticity or factual truth.

This contract is an intake artifact, not a decision record, an outcome label, a promotion request, or approval to change shared knowledge. Replay and MESH consumers must preserve these distinctions and must not promote this capture automatically.
