# Friday Intelligence Layer Feedback v3

**Copy the block below and feed it to Claude for the final polish pass.**

```markdown
**Final focused revision — only touch the Phase 5 / Intelligence Layer section** of 2026-03-29-agent-teams-design.md.

This is the last iteration. Goal: tighten, polish, and lock it in. Do not expand scope, do not add new concepts, do not lengthen the overall section.

**What you did well (keep and strengthen):**
- Philosophical framing and core principles.
- Collaboration tokens table (including the full set).
- Living plan.md artifact details and editing semantics.
- The golden transcript example — it is excellent. Preserve its length, realism, and demonstration value.
- 5a/5b/5c phasing, planner data shapes, tool surface, and testing strategy (especially golden transcript fixtures).
- Explicit personality integration rules that correctly defer to GENESIS.

**Targeted changes needed:**
1. **Tighten the INTELLIGENCE_SYSTEM_PROMPT.** It is still a bit long. Remove any remaining redundancy, shorten the "Voice — Non-Negotiable" and "What You Never Do" sections without losing the anti-chatbot warnings. Make the language even more direct and Friday-like.
2. **Voice fidelity in the example conversation.** Polish the 2–3 spots where Friday sounds slightly too explanatory or transitional. Make her even tighter, drier, and more opinionated — match the exact register from the recalled session (lead with the answer, no narration of process, occasional cheekiness).
3. **Symlink/convenience surfaces.** Simplify the language around ~/.friday/teams/{slug}/plan.md and the CLI commands. Make the convention clean and final.
4. **Remove the last bits of redundancy** between the prose red-teaming description and the prompt text. One source of truth.
5. **Testing strategy.** Make the golden transcript validation (replay + diff against committed reference) crystal clear in one tight paragraph.

Preserve every strength. Deliver the complete revised Phase 5 section only (from the "> **Framing:** The Intelligence Layer..." block through the end of the testing strategy). Keep the same markdown structure and code block formatting.

Make it the version we can approve and stop iterating on.
```
---

**Notes for us:**
- This should get us to a lockable version.
- After Claude responds, I'll review the new Phase 5 and give you the final verdict.
- The current spec is very close — we're mostly doing final tightening now.
