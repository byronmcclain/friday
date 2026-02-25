# Gmail Module Design

**Date:** 2026-02-25
**Status:** Approved
**Author:** Friday (with human approval)

## Overview

A core Gmail module giving Friday her own email identity. This is Friday's email account — she owns the full inbox lifecycle: read, search, send, reply, label, archive, delete. She communicates as herself via email when needed.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Gmail only | Yes | Scoped to Gmail API; no generic IMAP/SMTP |
| Auth | OAuth 2.0 (Desktop app) | Only viable option for personal Gmail accounts |
| API client | `googleapis` npm package | User plans broader Google integrations (Calendar, Drive); package already includes Gmail + OAuth2 client |
| Autonomy model | Read freely, gate sends | `"network"` clearance for reads/search/organize; new `"email-send"` clearance for send/reply |
| Token storage | SQLite via ScopedMemory | Consistent with existing persistence patterns |
| Encryption | AES-256-GCM + OS keychain master key | Application-layer encryption of token values; master key in macOS Keychain / Linux secret-tool; env var fallback |
| Architecture | Monolithic module | All Gmail functionality in `src/modules/gmail/`; SecretStore in `src/core/` as reusable infrastructure. Refactor auth out when second Google module is built. |

## SecretStore (`src/core/secrets.ts`)

Reusable encrypted storage utility for sensitive values. Any module can use it.

### Encryption

- AES-256-GCM via `node:crypto`
- Random 256-bit master key generated on first use
- Each value gets a unique IV (12 bytes) + auth tag (16 bytes)
- Stored format in ScopedMemory: `iv:authTag:ciphertext` (base64-encoded)

### Master Key Storage (OS Keychain)

- Platform detection via `process.platform`
- **macOS:** `security add-generic-password` / `security find-generic-password` — service: `"friday"`, account: `"master-key"`
- **Linux:** `secret-tool store` / `secret-tool lookup` — attribute: `service=friday, key=master-key`
- Fallback: `FRIDAY_SECRET_KEY` env var with a warning if neither CLI is available
- Key cached in memory for process lifetime

### Interface

```ts
class SecretStore {
  constructor(memory: ScopedMemory)
  async encrypt(key: string, value: string): Promise<void>
  async decrypt(key: string): Promise<string | null>
  async delete(key: string): Promise<void>
  async has(key: string): Promise<boolean>
}
```

### Clearance

No dedicated clearance. SecretStore is internal infrastructure — modules gate access through their own clearance requirements.

## OAuth 2.0 Flow (`src/modules/gmail/auth.ts`)

### Prerequisites

- Google Cloud project with Gmail API enabled
- OAuth 2.0 Client ID (Desktop application type)
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars

### Token Lifecycle

1. **First run (no tokens):** Detect missing tokens in SecretStore -> generate authorization URL -> print to console/TUI -> user visits URL, grants consent -> localhost one-shot HTTP listener catches callback -> exchange auth code for access + refresh tokens -> store in SecretStore.

2. **Normal run (tokens exist):** Load tokens from SecretStore on module load -> check access token expiry -> if expired, `googleapis` OAuth2 client auto-refreshes -> `"tokens"` event persists new tokens to SecretStore.

3. **Token refresh failure:** Refresh token revoked/invalid -> log warning, emit `custom:gmail-auth-expired` signal -> tools return "re-authentication required" error -> user runs `/gmail auth`.

### Stored Secrets

- `gmail:access_token`
- `gmail:refresh_token`
- `gmail:token_expiry` (ISO timestamp)

### googleapis Integration

```ts
import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
oauth2Client.setCredentials({ access_token, refresh_token });

// Auto-persist on refresh
oauth2Client.on("tokens", (tokens) => {
  // persist to SecretStore
});
```

### Scopes

- `https://www.googleapis.com/auth/gmail.readonly` — Read, search, labels
- `https://www.googleapis.com/auth/gmail.send` — Send and reply
- `https://www.googleapis.com/auth/gmail.modify` — Archive, label, trash, mark read/unread
- `https://www.googleapis.com/auth/gmail.labels` — Create/manage labels

## GmailClient (`src/modules/gmail/client.ts`)

Thin wrapper around `googleapis` Gmail client. Handles auth lifecycle, provides typed methods for tools.

### Interface

```ts
class GmailClient {
  constructor(secretStore: SecretStore)

  // Lifecycle
  async initialize(): Promise<boolean>  // returns false if auth needed
  isAuthenticated(): boolean

  // Read
  async getMessage(id: string, format?: "full" | "metadata" | "minimal"): Promise<GmailMessage>
  async listMessages(query: string, maxResults?: number): Promise<GmailMessageList>

  // Send
  async sendMessage(to: string, subject: string, body: string, cc?: string, bcc?: string): Promise<{ id: string; threadId: string }>
  async replyToThread(threadId: string, body: string): Promise<{ id: string; threadId: string }>

  // Organize
  async modifyMessage(id: string, opts: { addLabels?: string[]; removeLabels?: string[] }): Promise<void>
  async trashMessage(id: string): Promise<void>
  async deleteMessage(id: string): Promise<void>

  // Labels
  async listLabels(): Promise<GmailLabel[]>
}
```

### Types (`src/modules/gmail/types.ts`)

```ts
interface GmailMessage {
  id: string
  threadId: string
  from: string
  to: string[]
  cc: string[]
  subject: string
  date: string
  snippet: string
  body: string          // decoded text/plain or stripped text/html
  labels: string[]
  isUnread: boolean
}

interface GmailMessageList {
  messages: GmailMessage[]
  nextPageToken?: string
  resultSizeEstimate: number
}

interface GmailLabel {
  id: string
  name: string
  type: "system" | "user"
  messagesTotal: number
  messagesUnread: number
}
```

### Email Body Handling

- Gmail API returns bodies as base64url-encoded MIME parts
- Prefer `text/plain` part when available
- Fall back to `text/html` -> strip tags to plain text
- Multipart messages: walk the MIME tree to find the right part

## Tools

Six tools in `src/modules/gmail/tools/`, each following the `FridayTool` pattern.

### `gmail.search`

- **Parameters:** `query` (string, required — Gmail search syntax), `max_results` (number, optional, default 10)
- **Clearance:** `["network"]`
- **Returns:** List of messages with id, from, subject, date, snippet, labels, unread status
- **Examples:** `"is:unread"`, `"from:github.com"`, `"subject:invoice after:2026/01/01"`

### `gmail.read`

- **Parameters:** `id` (string, required — message ID from search results)
- **Clearance:** `["network"]`
- **Returns:** Full message with decoded body, headers, attachment metadata (name, size, mimeType — not content)

### `gmail.send`

- **Parameters:** `to` (string, required), `subject` (string, required), `body` (string, required), `cc` (string, optional), `bcc` (string, optional)
- **Clearance:** `["network", "email-send"]`
- **Returns:** Sent message ID and thread ID

### `gmail.reply`

- **Parameters:** `thread_id` (string, required), `body` (string, required)
- **Clearance:** `["network", "email-send"]`
- **Returns:** Sent message ID and thread ID
- **Behavior:** Auto-sets `In-Reply-To` and `References` headers, preserves thread context

### `gmail.modify`

- **Parameters:** `id` (string, required), `action` (string, required — one of `"archive"`, `"trash"`, `"delete"`, `"mark_read"`, `"mark_unread"`, `"label"`, `"unlabel"`), `label` (string, optional — required for `"label"`/`"unlabel"` actions)
- **Clearance:** `["network"]`
- **Behavior:** `"archive"` = remove INBOX label, `"mark_read"` = remove UNREAD label, etc.

### `gmail.list_labels`

- **Parameters:** none
- **Clearance:** `["network"]`
- **Returns:** All labels with name, type (system/user), total and unread counts

## Protocol (`/gmail`)

Slash command for human access. Aliases: `/mail`, `/email`.

| Command | Description |
|---|---|
| `/gmail inbox [count]` | Show latest inbox messages (default 10) with from, subject, date, unread indicator |
| `/gmail unread` | Show unread count + summaries |
| `/gmail search <query>` | Search using Gmail query syntax |
| `/gmail read <id>` | Display full email body with headers |
| `/gmail send <to> <subject>` | Prompts for body interactively, then sends |
| `/gmail reply <thread_id>` | Prompts for body, sends reply in thread |
| `/gmail labels` | List all labels with unread counts |
| `/gmail auth` | Initiate OAuth flow |
| `/gmail auth status` | Show token validity and expiry |

Protocol clearance mirrors tools: `["network"]` for reads, `"email-send"` check for `send`/`reply` subcommands.

## Module Manifest

```ts
const gmailModule = {
  name: "gmail",
  description: "Gmail integration — read, search, send, reply, and organize Friday's email account via the Gmail API.",
  version: "1.0.0",
  tools: [gmailSearch, gmailRead, gmailSend, gmailReply, gmailModify, gmailListLabels],
  protocols: [gmailProtocol],
  knowledge: [],
  triggers: ["custom:gmail-auth-expired"],
  clearance: ["network", "email-send"],
  async onLoad() { /* initialize GmailClient, load tokens */ },
  async onUnload() { /* cleanup */ },
} satisfies FridayModule;
```

### Boot Behavior

- Auto-discovered by existing module loader (`discoverModules` globs `*/index.ts`)
- `onLoad` initializes GmailClient and attempts to load tokens from SecretStore
- If no tokens exist (first run), boots fine but tools return "Run `/gmail auth` to authenticate"
- No hard dependency on Gmail being configured — graceful degradation

### Signals

- `custom:gmail-auth-expired` — emitted when token refresh fails
- Available to directives (e.g., notify user, pause email-related rhythms)

## Core Changes

| File | Change |
|---|---|
| `src/core/clearance.ts` | Add `"email-send"` to `ClearanceName` union |
| `src/core/events.ts` | Add `"custom:gmail-auth-expired"` to `SignalName` union |
| `src/core/secrets.ts` | New file — `SecretStore` class |

## File Structure

```
src/core/secrets.ts                  <- SecretStore (new, reusable)
src/core/clearance.ts                <- add "email-send" to ClearanceName
src/core/events.ts                   <- add "custom:gmail-auth-expired" to SignalName
src/modules/gmail/
  index.ts                           <- FridayModule manifest + onLoad/onUnload
  types.ts                           <- GmailMessage, GmailMessageList, GmailLabel
  client.ts                          <- GmailClient (googleapis wrapper + SecretStore)
  auth.ts                            <- OAuth 2.0 flow (consent URL, localhost callback, code exchange)
  protocol.ts                        <- /gmail protocol with subcommands
  tools/
    search.ts                        <- gmail.search
    read.ts                          <- gmail.read
    send.ts                          <- gmail.send
    reply.ts                         <- gmail.reply
    modify.ts                        <- gmail.modify
    labels.ts                        <- gmail.list_labels
```

## Dependencies

- `googleapis` (npm package) — Google API client library

## Environment Variables

- `GOOGLE_CLIENT_ID` — required for OAuth
- `GOOGLE_CLIENT_SECRET` — required for OAuth
- `FRIDAY_SECRET_KEY` — fallback only, if OS keychain unavailable
