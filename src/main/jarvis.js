"use strict";
// Jarvis: the chat window's agent loop, on the Claude Agent SDK.
//
// The point of running the SDK rather than a hand-written tool loop is that the
// organs the brain can only *describe* - files, scripts, the Ablage - are the
// SDK's built-in tools, and the subagents (Ordnungs-Agent, Cortex-Agent) are a
// config object instead of a second loop.
//
// Everything the brain reads lives behind the cortex MCP server below, so Jarvis
// and the brain share one state: what he writes, the brain redraws.

const { query, createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const MODEL = process.env.JARVIS_MODEL || "claude-opus-5";

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

// --------------------------------------------------------------------- tools
// One server, because these are all the same organ from Jarvis's side: the
// cortex's own state plus the two connectors the brain already drives.
function cortexServer({ store, registry }) {
  return createSdkMcpServer({
    name: "cortex",
    version: "1.0.0",
    instructions:
      "The Semester-Cortex: the user's study brain. Tasks and deadlines live in Todoist, " +
      "appointments in Google Calendar, and the spaced-repetition memory in the cortex store.",
    tools: [
      tool(
        "read_doc",
        "Read one cortex document, e.g. cortex/zustand, cortex/tagesplan, cortex/bericht, journal/intake.",
        { path: z.string().describe('Document path as "collection/id"') },
        async ({ path }) => {
          const { exists, data } = store.get(path);
          return text(exists ? data : { missing: true, path });
        },
        { annotations: { readOnlyHint: true } },
      ),

      tool(
        "list_collection",
        "List every document in a cortex collection: themen (study topics), vorschlaege (pending suggestions), agenten, cortex, journal.",
        { collection: z.string().describe("Collection name, e.g. themen") },
        async ({ collection }) => text(store.list(collection)),
        { annotations: { readOnlyHint: true } },
      ),

      tool(
        "write_doc",
        "Create or change a cortex document. Use merge for a partial update. The brain redraws immediately.",
        {
          path: z.string().describe('Document path as "collection/id"'),
          value: z.record(z.any()).describe("The document body, or the fields to merge"),
          merge: z.boolean().optional().describe("Merge into the existing document instead of replacing it"),
        },
        async ({ path, value, merge }) => text(store.write(path, value, merge !== false)),
      ),

      tool(
        "todoist",
        "Call Todoist. Tools: get-overview (pass projectId for a project's sections and tasks), add-tasks, complete-tasks, uncomplete-tasks, reschedule-tasks.",
        {
          tool: z.string().describe("Todoist tool name"),
          input: z.record(z.any()).optional().describe("Tool arguments"),
        },
        async ({ tool: name, input }) => text(await registry.call("Todoist", name, input || {})),
      ),

      tool(
        "calendar",
        "Call Google Calendar. Tools: list_events, create_event, update_event. Times are RFC3339 with an offset.",
        {
          tool: z.string().describe("Calendar tool name"),
          input: z.record(z.any()).optional().describe("Tool arguments"),
        },
        async ({ tool: name, input }) => text(await registry.call("Google Calendar", name, input || {})),
      ),
    ],
  });
}

// ---------------------------------------------------------------- subagents
// The organs from the brain's ORGANE list that do real work, as agents. Their
// instructions mirror the Reflexe organ, because those rules are the whole
// reason the file organ is allowed to touch anything at all.
const REFLEXE =
  "Hard rules, no exceptions: never delete anything - move it to a dated quarantine folder instead. " +
  "Never overwrite an existing file. Never touch a download that is still in progress. " +
  "Report credentials you find, never copy or move them. Log every file movement. " +
  "You propose; the user decides what actually runs.";

const AGENTS = {
  "ordnungs-agent": {
    instructions:
      "You are the Ordnungs-Agent. You look after files, folder structure, scripts and logs on this machine. " +
      "Work from metadata - names, sizes, timestamps, paths - and do not open documents to read their content. " +
      `The Ablage is organised by area of life: 01 Studium & Ausbildung, 02 Kanu & Verein, 05 Finanzen & Verwaltung, 99 Archiv. ${REFLEXE}`,
    tools: ["Read", "Glob", "Grep", "Bash"],
  },
  "cortex-agent": {
    instructions:
      "You are the Cortex-Agent. You audit the brain itself: the cortex page's code, how fresh its data is, " +
      "whether it is still usable, and whether it leaks anything private. " +
      "You report findings and propose patches; you never apply them yourself.",
    tools: ["Read", "Glob", "Grep", "mcp__cortex__read_doc", "mcp__cortex__list_collection"],
    permissionMode: "plan",
  },
};

function systemPrompt() {
  const now = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  return [
    "You are Jarvis, the assistant of a working student at the FOM. You are the chat half of his cortex:",
    "the brain window shows him his state, you are what changes it. Speak German with him, and say du.",
    `It is now ${now} (Europe/Berlin).`,
    "",
    "Be brief. He is between lectures, not reading an essay. Say what you did, not what you are about to do.",
    "Use the cortex tools before you guess: his tasks, appointments and study topics are all readable.",
    "When a job is about files on this machine, hand it to the ordnungs-agent. When it is about the brain",
    "itself - its code, its data, its privacy - hand it to the cortex-agent.",
    "",
    REFLEXE,
  ].join("\n");
}

// ------------------------------------------------------------------- driver
// One conversation per window. resume keeps Jarvis's memory across turns
// without this process holding the history itself.
function makeJarvis({ store, registry, cwd }) {
  let sessionId = null;
  let running = null;

  async function* ask(prompt) {
    const servers = { cortex: cortexServer({ store, registry }) };
    running = query({
      prompt,
      options: {
        model: MODEL,
        cwd,
        systemPrompt: systemPrompt(),
        mcpServers: servers,
        agents: AGENTS,
        permissionMode: "default",
        settingSources: ["project"],   // picks up .claude/ in this repo
        ...(sessionId ? { resume: sessionId } : {}),
      },
    });

    try {
      for await (const message of running) {
        if (message.session_id) sessionId = message.session_id;

        // The SDK reports assistant output either flattened or as a message
        // with content blocks, depending on version - handle both.
        if (message.type === "text" && message.text) {
          yield { kind: "text", text: message.text };
        } else if (message.type === "assistant") {
          for (const block of message.message?.content || []) {
            if (block.type === "text") yield { kind: "text", text: block.text };
            else if (block.type === "tool_use") yield { kind: "tool", name: block.name };
          }
        } else if (message.type === "tool_use") {
          yield { kind: "tool", name: message.name };
        } else if (message.type === "result") {
          yield { kind: "done", cost: message.total_cost_usd ?? null, error: message.is_error || false };
        }
      }
    } finally {
      running = null;
    }
  }

  return {
    ask,
    interrupt: () => running?.interrupt?.(),
    reset: () => { sessionId = null; },
  };
}

module.exports = { makeJarvis };
