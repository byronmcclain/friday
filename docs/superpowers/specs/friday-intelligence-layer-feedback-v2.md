**Prompt for Claude Code - Intelligence Layer Round 2**

**Update the Intelligence Layer (Phase 5) section again.**

Here is my feedback after reviewing your latest revision:

### What you did well:
- Strong philosophical framing at the start of Phase 5.
- Excellent Collaboration Tokens table (especially adding `ship it`, `why?`, `split`, and `merge`).
- Very good `plan.md` artifact template.
- Strong Self-Critique / Red-Team Loop section.
- Smart decision to split Phase 5 into 5a (Conversation Engine), 5b (Integration), and 5c (Runtime Intelligence).
- Good testing strategy using scripted sessions and golden transcripts.

### What still needs improvement:

1. **The actual Intelligence Layer System Prompt is still missing.**  
   The spec describes *what* the prompt should do but does not provide the real system prompt text. We need the full prompt.

2. **Add a concrete example dialogue.**  
   The section is still too abstract. Include a short but realistic example of a "conversation journey" (roughly 8–12 turns) showing how Friday and the Boss collaborate — including use of collaboration tokens, progressive refinement, opinionated pushback, and updating the living plan.

3. **Deeper personality integration.**  
   The prompt must explicitly require that planning conversations happen *in Friday’s established voice*: dry wit, warm but not saccharine, direct, opinionated, occasionally cheeky. She should feel like a trusted technical partner, not a generic assistant. Reference emotional calibration, memory recall, and the existing relationship dynamic between Friday and the Boss.

4. **plan.md location.**  
   Storing it only inside `.worktrees/teams/{teamId}/` is reasonable for isolation, but the spec should also discuss surfacing or symlinking it to the project root so the Boss can open it easily.

5. **Make the whole section more actionable.**  
   Move beyond principles and include more specific guidance for implementation.

---

Please revise the **Phase 5: Intelligence Layer** section (and any related parts of the spec) to incorporate this feedback. Keep the strengths of your previous version while addressing the gaps above. Make this the strongest, clearest, and most practical version yet.

Return only the revised Phase 5 section (plus any new supporting sections you add), not the entire document.
