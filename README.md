# Jarvis

A personal desktop cockpit: a chat window with the **Semester-Cortex** brain built into it.

The brain already existed as a claude.ai artifact — it reads Todoist and Google Calendar,
keeps a spaced-repetition memory, and draws the whole semester as organs. But half of the
organs it describes (Downloads, the PowerShell scripts, the Protokoll, the OneDrive Ablage)
could never actually run, because a web page cannot touch a filesystem, and its 08:30
Morgenlauf only fired if the page happened to be open.

This app is the other half. Same brain, now with hands.

```
┌─ Jarvis (chat) ──────────┐   ┌─ Cortex (brain) ─────────┐
│  Claude Agent SDK loop   │   │  the artifact, unchanged │
│  · cortex tools          │   │  Puls · Bahn · Gehirn    │
│  · ordnungs-agent        │   │                          │
│  · cortex-agent          │   │                          │
└────────────┬─────────────┘   └────────────┬─────────────┘
             │      one shared state        │
        ┌────┴──────────────────────────────┴────┐
        │  main process: store · connectors · API │
        └─────────────────────────────────────────┘
```

## How the brain got here unchanged

The artifact boots through exactly one entry point:

```js
const [mcp, db, sample] = await Promise.all([
  window.claude.use("mcp"), window.claude.use("db"), window.claude.use("sample"),
]);
```

So `src/preload/brain.js` reimplements those three capabilities against local
equivalents, and `src/renderer/brain/cortex.html` is the artifact as published —
not a port, a copy. Everything it needs is six call sites:

| Capability | On claude.ai | Here |
|---|---|---|
| `mcp.callTool` / `watchTool` / `invalidate` | connector tools | `src/main/connectors/` over the real Todoist and Google APIs |
| `db.doc` / `db.collection` + `onSnapshot` | artifact storage | `src/main/store.js`, JSON documents on disk |
| `sample.json` | model access, no key | `src/main/sample.js`, Anthropic SDK with your key |

Error codes are preserved too (`needs_reauth`, `rate_limited`, `quota_exceeded`, …),
because the brain maps them to its own German error text.

## Setup

```bash
npm install
cp .env.example .env     # then fill it in
npm start
```

What goes in `.env`:

| Key | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com — powers Jarvis and the brain's ask-bar |
| `TODOIST_API_TOKEN` | Todoist → Settings → Integrations → Developer |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | a Desktop-app OAuth client in Google Cloud Console, scope `calendar.events` |

The brain expects a Todoist project matching `/studium/i`, with one section per subject.

**`Ctrl+Shift+J`** opens Jarvis from anywhere. Closing a window leaves the app in the tray.

## Layout

```
src/main/
  index.js            Electron main: windows, tray, hotkey, IPC
  store.js            the db capability - atomic JSON documents
  sample.js           the sample capability - single-shot JSON completions
  jarvis.js           the Agent SDK loop, cortex tools, subagents
  connectors/
    index.js          the mcp capability - server/tool registry
    todoist.js        REST v2 -> the shape the brain already parses
    gcal.js           Calendar v3 over a refresh-token grant
src/preload/
  brain.js            window.claude.use() - the whole contract
  chat.js             the chat window's bridge
src/renderer/
  brain/cortex.html   the artifact, as published
  chat/index.html     the Jarvis window
```

## Who Jarvis is

Jarvis is the chat window itself, not a feature inside it — an Agent SDK loop whose
tools are the brain's organs. The organs that do work of their own are subagents:

- **ordnungs-agent** — files, folder structure, scripts, logs. Works from metadata only,
  never opens documents.
- **cortex-agent** — audits the brain itself: code, data freshness, privacy. Runs in
  `plan` mode, so it proposes and never applies.

Both inherit the **Reflexe** rules from the brain's own organ list: nothing is ever
deleted, only moved to a dated quarantine; nothing is overwritten; downloads in flight
are untouchable; credentials are reported, never copied; every movement is logged.

## Not built yet

- **Takt** — the 08:30 Morgenlauf as a real background job with OS notifications.
  This is the biggest single win left: it is what makes the brain work while it is closed.
- **three.js is still loaded from a CDN** by the Gehirn and Bahn views, so those two
  views need a connection. Vendoring it locally makes the whole brain work offline.
- **Gmail, Notion, Downloads** — organs the brain describes but nothing feeds yet.
- Google OAuth is a hand-pasted refresh token; a one-time in-app consent flow would be nicer.
