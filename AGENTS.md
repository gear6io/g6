## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- Use Graphify first for cross-file architecture, dependencies, call/data flow, impact analysis, ownership, related-file discovery, and other questions that need repository-wide context. Prefer the `graphify` MCP tools; fall back to `.venv/bin/graphify query "<question>"`, `.venv/bin/graphify path "<A>" "<B>"`, or `.venv/bin/graphify explain "<concept>"`.
- Use normal read/search tools directly for a known file, an exact text lookup, tests/logs/git diffs, generated files, or final verification before editing. Also fall back to them when the graph is missing, stale for the target, or does not answer the question.
- Before broad grep or reading several source files, make one scoped Graphify query. Do not query Graphify for every individual file read after orientation.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `.venv/bin/graphify update .` to keep the graph current (AST-only, no API cost).
