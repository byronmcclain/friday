# Gmail Setup Guide

Configure Friday's Gmail module so she can read, search, send, and organize email on your behalf.

## Overview

The Gmail module gives Friday her own email identity via the Gmail API. Once configured, she can:

- Read and search your inbox (or hers, if you give her a dedicated account)
- Send emails and reply to threads
- Archive, label, trash, and manage messages
- List and organize labels

All email access uses OAuth 2.0 — Friday never sees your Google password. Tokens are encrypted at rest using AES-256-GCM with a master key stored in your OS keychain.

## Prerequisites

- A Google account (personal Gmail or Google Workspace)
- Access to the [Google Cloud Console](https://console.cloud.google.com/)
- Friday installed and running (`bun run start` or `bun run dev`)

## Step 1: Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Click the project dropdown at the top and select **New Project**
3. Name it something like `friday-assistant` and click **Create**
4. Make sure the new project is selected in the dropdown

## Step 2: Enable the Gmail API

1. In your project, go to **APIs & Services > Library**
2. Search for **Gmail API**
3. Click **Gmail API** and then **Enable**

## Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Select **External** user type (unless you have a Workspace org and want Internal)
3. Fill in the required fields:
   - **App name:** Friday
   - **User support email:** your email
   - **Developer contact email:** your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
6. Click **Save and Continue**
7. On the **Test users** page, click **Add Users** and add the Google account you want Friday to access
8. Click **Save and Continue**, then **Back to Dashboard**

> **Note:** While the app is in "Testing" status, only the test users you added can authorize it. This is fine for personal use — you don't need to publish the app.

## Step 4: Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. For **Application type**, select **Desktop app** (not "Web application")
4. Name it `friday-cli` or similar
5. Click **Create**
6. Copy the **Client ID** and **Client Secret** from the dialog

> **Important:** You must select **Desktop app**. Friday uses a localhost callback (`http://localhost:3847/oauth2callback`) to receive the authorization code, which only works with the Desktop application type.

## Step 5: Configure Environment Variables

Add the credentials to your `.env` file in the Friday project root:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Bun loads `.env` automatically — no restart needed if you haven't started Friday yet.

## Step 6: Authorize Friday

1. Start Friday:
   ```bash
   bun run start
   ```
2. Run the auth command:
   ```
   /gmail auth
   ```
3. Friday will print an authorization URL. Open it in your browser.
4. Sign in with the Google account you added as a test user.
5. Grant the requested permissions.
6. The browser will redirect to `localhost:3847` and show "Authorization successful!"
7. Friday will confirm authentication is complete.

The OAuth tokens are now encrypted and stored. You won't need to repeat this unless you revoke access.

## Step 7: Verify

Check that everything is working:

```
/gmail auth status    # Should show "authenticated"
/gmail inbox          # Show latest inbox messages
/gmail labels         # List all labels
```

## Token Storage & Security

Friday never stores tokens in plaintext. Here's how it works:

- **Encryption:** Each token is encrypted with AES-256-GCM (unique IV per value, authenticated with an auth tag)
- **Master key:** A random 256-bit key generated on first use, stored in your OS keychain:
  - **macOS:** Keychain Access (service: `friday`, account: `master-key`)
  - **Linux:** `secret-tool` / GNOME Keyring (service: `friday`, key: `master-key`)
- **Fallback:** If no OS keychain is available (e.g., headless server, Docker), set `FRIDAY_SECRET_KEY` in your `.env`:
  ```bash
  FRIDAY_SECRET_KEY=your-secret-key-at-least-32-characters-long
  ```

Tokens auto-refresh silently. When Google issues a new access token, Friday re-encrypts and persists it automatically.

## Available Commands

### Protocol Commands (human access)

| Command | Description |
|---|---|
| `/gmail inbox [count]` | Show latest inbox messages (default 10) |
| `/gmail unread` | Show unread messages |
| `/gmail search <query>` | Search using Gmail query syntax |
| `/gmail read <id>` | Display full email with headers and body |
| `/gmail send` | Send an email (use via natural language) |
| `/gmail reply` | Reply to a thread (use via natural language) |
| `/gmail labels` | List all labels with unread counts |
| `/gmail auth` | Start OAuth authorization flow |
| `/gmail auth status` | Check authentication status |

Aliases: `/mail` and `/email` work the same as `/gmail`.

### Cortex Tools (AI access)

These are the tools Friday uses autonomously when you ask her to handle email:

| Tool | Description | Clearance |
|---|---|---|
| `gmail.search` | Search messages with Gmail query syntax | `network` |
| `gmail.read` | Read a full message by ID | `network` |
| `gmail.send` | Compose and send an email | `network`, `email-send` |
| `gmail.reply` | Reply within a thread | `network`, `email-send` |
| `gmail.modify` | Archive, trash, label, mark read/unread | `network` |
| `gmail.list_labels` | List all labels | `network` |

Send and reply require `email-send` clearance — Friday will ask for permission before sending on your behalf.

## Troubleshooting

### "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set"

The Gmail module couldn't find the OAuth credentials. Make sure both variables are set in your `.env` file and that you've restarted Friday after adding them.

### "Not authenticated. Run /gmail auth"

Tokens haven't been set up yet, or they were cleared. Run `/gmail auth` to start the OAuth flow.

### OAuth error: "redirect_uri_mismatch"

You likely created a **Web application** OAuth client instead of a **Desktop app**. Go to Google Cloud Console > Credentials, delete the web client, and create a new one with type **Desktop app**.

### OAuth error: "access_denied"

The Google account you're signing in with isn't listed as a test user. Go to OAuth consent screen > Test users and add the account.

### "Could not store master key in OS keychain"

Your system doesn't have a compatible keychain CLI (`security` on macOS, `secret-tool` on Linux). Set `FRIDAY_SECRET_KEY` in `.env` as a fallback:

```bash
FRIDAY_SECRET_KEY=any-string-at-least-32-characters-long-here
```

### Tokens expired / "re-authentication required"

The refresh token may have been revoked (e.g., you removed app access from your Google account settings). Run `/gmail auth` again to re-authorize.

### Gmail module loads but commands fail silently

Check that the Gmail API is enabled in your Google Cloud project (Step 2). The OAuth credentials alone aren't enough — the API must be explicitly enabled.
