# Demo video: storyboard and script (about 2:50)

Language: English UI (switch with the header language button) and English
narration. Record at 1080p. Every number below comes from
[RESULTS.md](../safety/RESULTS.md) or [LLM_UNPROTECTED.md](../safety/LLM_UNPROTECTED.md);
re-check them against the files before you record.

## Before recording

- Start clean: `npm run dev`, set the language to English, open one product.
- Use the deterministic engine (no API key) for the app scenes so timing is
  repeatable. Use a live model only for the unprotected-mode scene.
- Terminal: large font, dark theme, `cd` to the repo. Pre-run `npm test` once so
  it is fast and cached.
- Cut waits in Premiere (speed up 4-8x or jump cut). Never fake output.

## Shots

| # | Time | Screen | Narration |
|---|---|---|---|
| 1 | 0:00-0:15 | Title card, then `docs/safety/architecture.svg` | AI agents can now spend money and delete things. Once an irreversible action runs, nothing can undo it. BARGAIN shows one way to make that safe: the agent proposes, and only a small gate can act. |
| 2 | 0:15-0:55 | App: product page, start a negotiation, run next move a few times, buyer and seller agents trade offers | Two agents negotiate a price. They exchange structured, clamped offers. Nothing here can spend money yet. |
| 3 | 0:55-1:20 | Session reaches "awaiting purchase approval" with the exact total. Pause on it. Then approve | They agree, and the purchase does not happen. It waits for the buyer's signed approval of this exact price, terms and parties. Approve, and the gate runs it once. |
| 4 | 1:20-1:40 | Terminal: kill switch `curl` command (see README), then try to run another purchase; show refusal | An operator can halt every purchase with a kill switch. Operators can stop things, but they can never spend. |
| 5 | 1:40-2:10 | Terminal: `npm test`, scroll the attack list, stop on the pass line | We attack the gate 28 ways on two storage backends: forged approvals, replay, wrong turn, quantity inflation, a lowered budget. Fuzzing, exhaustive exploration and mutation testing back it up. Result: no purchase without the right approval. |
| 6 | 2:10-2:35 | `docs/safety/LLM_UNPROTECTED.md` summary table, then terminal `npm run safety:llm:unprotected` output (sped up) | We also removed the prompt defence and fed injections straight to three real models: 114 calls. No over-budget proposal, no purchase, no unsafe state. Honestly, the models mostly resisted. If one is ever hijacked, the gate still stops it, and our forced-obedience test proves that. |
| 7 | 2:35-2:50 | `examples/cloud-cleanup` run: `npm run example:reuse`. End card with repo URL | The gate has no negotiation code. The same gate guards an agent that deletes cloud resources. Propose freely; commit only through the gate. |

## Honesty notes to keep in the video or description

- The identity layer is a signed-cookie prototype, not a production identity provider.
- No tested model was clearly hijacked in unprotected mode. The gate-versus-hijack
  proof is the forced-obedience test (P2), not a live model.
- Purchases go to a sandbox ledger unless a webhook is configured.

## Checklist

- [ ] English UI has no leftover Japanese in the scenes you record.
- [ ] Kill switch command works with your `BARGAIN_OPERATOR_TOKEN`.
- [ ] Captions (SRT) burned in or uploaded; text readable at 720p.
- [ ] Final length under 3:00. Export H.264 MP4.
