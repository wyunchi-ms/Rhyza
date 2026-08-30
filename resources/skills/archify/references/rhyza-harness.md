# Rhyza GPT Harness

Rhyza registers this filesystem skill with its existing Pi/GPT agent. It does not add another model provider, credential path, network client, or resident service. The Electron main process runs the bundled Archify CLI with `ELECTRON_RUN_AS_NODE=1` after receiving a specification.

## Output contract

1. Choose one of `architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle` and follow the matching schema, common schema, and one JSON example.
2. Author a bounded candidate and validate it with `node <this-skill>/bin/archify.mjs validate <type> <candidate.json> --quality showcase --json`. Use at most two focused diagnostic repair rounds.
3. Do not set `meta.output`; the host owns all output paths. Do not return an HTML/SVG artifact or a link to a temporary candidate.
4. After the final successful validation, do not change the JSON. Include those exact JSON bytes (formatting differences are allowed, semantic changes are not) in one fenced block with the exact `archify` language tag:

   ```archify
   {
     "schema_version": 1,
     "diagram_type": "architecture",
     "meta": { "title": "...", "quality_profile": "showcase" }
   }
   ```

5. Keep the surrounding prose short. Rhyza will validate and render the block into a sandboxed interactive HTML viewer. If deterministic delivery fails, Rhyza shows a Mermaid fallback derived from the same authored topology.

The `archify` fence is reserved for the schemas in this skill; it is not a generic graph-JSON language tag. Do not emit roots shaped like `type/nodes/edges`, `version/title/type/lanes/events`, or place `title` at the root. Those belong to unrelated diagram formats and will fail the host's deterministic validator.

Use a temporary candidate path and remove it after copying the frozen specification into the response. Never edit application source or unrelated workspace files merely to produce a diagram.
