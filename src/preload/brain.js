"use strict";
// The capability shim. The brain boots with window.claude.use("mcp"|"db"|"sample")
// and nothing else, so this file is the entire contract between 2452 lines of
// cortex and the desktop app. Keep the shapes exactly as claude.ai served them:
//   mcp    callTool -> {payload} | watchTool(cb) -> unsubscribe | invalidate
//   db     doc(path).{set,update,onSnapshot} | collection(name).onSnapshot
//   sample json(prompt, opts) -> parsed object
// Errors must carry .code, because the brain maps codes to German user text.

const { contextBridge, ipcRenderer } = require("electron");

const asError = (e) => {
  const err = new Error(e?.message || e?.code || "unknown");
  err.code = e?.code || "tool_error";
  return err;
};

// ------------------------------------------------------------------ mcp
function makeMcp() {
  // One cache entry per server+tool+input, shared by every watcher of that call,
  // so two views of the same data never cost two round trips.
  const cache = new Map();
  const key = (s, t, i) => [s, t, JSON.stringify(i || {})].join("::");

  async function callTool(server, tool, input) {
    const res = await ipcRenderer.invoke("mcp:call", { server, tool, input });
    if (!res.ok) throw asError(res.error);
    return { payload: res.payload };
  }

  function watchTool(server, tool, input, cb, opts = {}) {
    const k = key(server, tool, input);
    let entry = cache.get(k);
    if (!entry) {
      entry = { listeners: new Set(), last: null, timer: null, server, tool, input };
      cache.set(k, entry);
    }
    entry.listeners.add(cb);
    if (entry.last) queueMicrotask(() => cb(entry.last));

    const run = async () => {
      let ev;
      try {
        ev = { type: "result", result: { payload: (await callTool(server, tool, input)).payload } };
      } catch (e) {
        ev = { type: "error", error: { code: e.code, message: e.message } };
      }
      entry.last = ev;
      for (const l of entry.listeners) { try { l(ev); } catch {} }
    };
    entry.refetch = run;

    if (!entry.timer) {
      run();
      const every = Number(opts.refetchInterval) || 0;
      entry.timer = every > 0 ? setInterval(run, every) : "once";
    }

    return () => {
      entry.listeners.delete(cb);
      if (entry.listeners.size === 0) {
        if (entry.timer && entry.timer !== "once") clearInterval(entry.timer);
        cache.delete(k);
      }
    };
  }

  // The brain calls this right after a write, to pull the change back in.
  async function invalidate(server, tool) {
    const jobs = [];
    for (const entry of cache.values()) {
      if (entry.server === server && entry.tool === tool && entry.refetch) jobs.push(entry.refetch());
    }
    await Promise.all(jobs);
  }

  return { callTool, watchTool, invalidate };
}

// ------------------------------------------------------------------ db
function makeDb() {
  const docWatchers = new Map();   // path -> Set<{next,error}>
  const colWatchers = new Map();   // collection -> Set<{next,error}>

  ipcRenderer.on("db:changed", (_e, { path, collection }) => {
    for (const w of docWatchers.get(path) || []) pushDoc(path, w);
    for (const w of colWatchers.get(collection) || []) pushCollection(collection, w);
  });

  async function pushDoc(path, w) {
    const res = await ipcRenderer.invoke("db:get", { path });
    if (!res.ok) return w.error?.(asError(res.error));
    w.next({ exists: res.exists, id: path.split("/")[1], data: () => res.data });
  }

  async function pushCollection(name, w) {
    const res = await ipcRenderer.invoke("db:list", { collection: name });
    if (!res.ok) return w.error?.(asError(res.error));
    w.next({ docs: res.docs.map((d) => ({ id: d.id, data: () => d.data })) });
  }

  const subscribe = (map, k, w) => {
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(w);
    return () => map.get(k)?.delete(w);
  };

  return {
    doc(path) {
      return {
        async set(value) {
          const res = await ipcRenderer.invoke("db:write", { path, value, merge: false });
          if (!res.ok) throw asError(res.error);
        },
        async update(value) {
          const res = await ipcRenderer.invoke("db:write", { path, value, merge: true });
          if (!res.ok) throw asError(res.error);
        },
        async delete() {
          const res = await ipcRenderer.invoke("db:delete", { path });
          if (!res.ok) throw asError(res.error);
        },
        onSnapshot(next, error) {
          const w = { next, error };
          pushDoc(path, w);                       // fire once immediately, like Firestore
          return subscribe(docWatchers, path, w);
        },
      };
    },
    collection(name) {
      return {
        onSnapshot(next, error) {
          const w = { next, error };
          pushCollection(name, w);
          return subscribe(colWatchers, name, w);
        },
      };
    },
  };
}

// ------------------------------------------------------------------ sample
function makeSample() {
  return {
    async json(prompt, opts = {}) {
      const id = Math.random().toString(36).slice(2);
      if (opts.signal) {
        if (opts.signal.aborted) throw asError({ code: "cancelled" });
        opts.signal.addEventListener("abort", () => ipcRenderer.send("sample:abort", { id }), { once: true });
      }
      const res = await ipcRenderer.invoke("sample:json", { id, prompt });
      if (!res.ok) throw asError(res.error);
      return res.value;
    },
  };
}

const caps = { mcp: makeMcp(), db: makeDb(), sample: makeSample() };

contextBridge.exposeInMainWorld("claude", {
  // The brain tolerates a null here and degrades gracefully, so an unknown
  // capability name resolves rather than throws.
  use: async (name) => caps[name] || null,
});
