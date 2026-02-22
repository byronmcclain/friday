---
name: bun-directory-listing-script
domain: bun
tags:
  - filesystem
  - readdir
  - directory-listing
  - javascript
confidence: 0.7
source: conversation
created: 2026-02-22
updated: 2026-02-22
---

## List Directory Files with Bun/Node

```javascript
import { readdir } from 'fs/promises';

async function listDir(path = '.') {
  try {
    const files = await readdir(path, { withFileTypes: true });
    for (const dirent of files) {
      console.log(`${dirent.isDirectory() ? 'DIR ' : 'FILE'} ${dirent.name}`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

listDir(process.argv[2] || '.');
```

**Run:** `bun run list.js /path`
