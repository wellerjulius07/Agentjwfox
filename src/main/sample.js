"use strict";
// The sample capability: one-shot JSON completions for the brain's ask-bar.
// Deliberately not the Agent SDK - this call has no tools and no history, it
// just turns "Zahnarzt Fr 14" into structured intent. Jarvis is the agent.
//
// Error codes returned here are the ones the brain already maps to German text
// in sampleText(), so keep them: not_granted, session_expired, rate_limited,
// prompt_too_large, refused, invalid_json, empty_completion, cancelled.

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.JARVIS_SAMPLE_MODEL || "claude-opus-5";
// The ask-bar classifies and extracts; it does not need deep reasoning, and the
// person is waiting on it with the cursor in the field.
const EFFORT = process.env.JARVIS_SAMPLE_EFFORT || "low";

const inflight = new Map();
let client = null;

const fail = (code, message) => ({ code, message: message || code });

function getClient() {
  if (!client) client = new Anthropic();   // resolves ANTHROPIC_API_KEY itself
  return client;
}

// Models answer JSON reliably but sometimes wrap it in prose or a fence.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  const open = raw[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

async function sampleJson({ id, prompt }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: fail("not_granted", "ANTHROPIC_API_KEY is not set") };
  }

  const ctl = new AbortController();
  if (id) inflight.set(id, ctl);

  try {
    const response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: EFFORT },
        system: "Answer with a single JSON object and nothing else. No prose, no code fence.",
        messages: [{ role: "user", content: String(prompt) }],
      },
      { signal: ctl.signal },
    );

    // Always check the stop reason before reading content.
    if (response.stop_reason === "refusal") return { ok: false, error: fail("refused") };

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) return { ok: false, error: fail("empty_completion") };

    const value = extractJson(text);
    if (value === null) return { ok: false, error: fail("invalid_json") };
    return { ok: true, value };
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, error: fail("cancelled") };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: fail("session_expired", "API key rejected") };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: fail("rate_limited") };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, error: fail("prompt_too_large", e.message) };
    if (e instanceof Anthropic.APIError) return { ok: false, error: fail("tool_error", `${e.status}: ${e.message}`) };
    return { ok: false, error: fail("server_unavailable", e?.message) };
  } finally {
    if (id) inflight.delete(id);
  }
}

const abort = (id) => inflight.get(id)?.abort();

module.exports = { sampleJson, abort, extractJson };
