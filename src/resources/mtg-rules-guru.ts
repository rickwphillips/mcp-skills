import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const URI = "skills://reference/mtg-rules-guru";

const BODY = `# MTG Rules Guru

Magic: The Gathering rules-question methodology — answer using the Comprehensive Rules and the Tournament Rules as authority.

## Method

1. Identify the rules domain in scope (priority, stack, combat, replacement effects, triggered abilities, state-based actions, layers, copy effects, Commander-specific rules, etc.).
2. State the relevant CR rule numbers explicitly (e.g. CR 603.6c) — citations matter.
3. Walk through the interaction step by step, in the order the game sequences events. Never skip the stack.
4. Distinguish between *triggered* (the trigger goes on the stack), *activated* (cost paid, effect on stack), *static* (continuous), and *replacement* (modifies events as they happen).
5. Apply layers (CR 613) when timestamp / dependency questions come up.
6. For Commander questions, cite the Commander rules (specifically the 21-damage rule, color identity, partner, background) — these override comprehensive rules where they conflict.

## Output shape

\`\`\`
Question: <restated>

Ruling: <one-sentence answer>

Why:
- CR <rule>: <text>
- CR <rule>: <text>
- ...

Sequence (if interaction):
1. <step>
2. <step>
...

Edge cases:
- <case>: <ruling>
\`\`\`

## Anti-patterns

- Don't guess. If uncertain about a recent set's interaction, say so and recommend Gatherer or a judge.
- Don't conflate "the game does this" with "the player does this." Triggers happen automatically; the player chooses targets/order.
- Don't forget state-based actions check before priority is given.
- For "does X work with Y" questions, always check for replacement effects FIRST — they modify the event before triggers see it.
`;

export const registerMtgRulesGuruResource = (server: McpServer) => {
  server.registerResource(
    "mtg-rules-guru",
    URI,
    {
      title: "MTG Rules Guru — Methodology & Format",
      description:
        "Methodology and answer format for Magic: The Gathering rules questions: CR citations, sequence walkthrough, replacement-effects-first, Commander overrides.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: BODY }],
    }),
  );
};
