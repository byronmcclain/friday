---
name: bun-shell-ls-command
domain: bun
tags:
  - shell
  - ls
  - bun-shell
confidence: 0.7
source: conversation
created: 2026-02-22
updated: 2026-02-22
---

## Bun Shell `ls` One-Liner

```javascript
console.log(await Bun.$`ls -la`.text());
```

Executes `ls -la` via Bun's `$` shell and prints output.
