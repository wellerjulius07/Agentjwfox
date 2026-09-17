"use strict";
// The db capability, on disk. The brain talks Firestore shapes (doc/collection/
// onSnapshot), so that is what this serves - backed by plain JSON files, because
// the whole cortex is a few hundred small documents and a native sqlite build is
// not worth the rebuild dance on one machine.
//
// Layout:  <userData>/cortex/<collection>/<docId>.json
// Paths are always "collection/docId" (e.g. "cortex/tagesplan", "themen/analysis-1").

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const SAFE = /^[A-Za-z0-9._-]+$/;

class Store extends EventEmitter {
  constructor(root) {
    super();
    this.setMaxListeners(0);
    this.root = root;
    fs.mkdirSync(this.root, { recursive: true });
  }

  _split(docPath) {
    const parts = String(docPath).split("/").filter(Boolean);
    if (parts.length !== 2) throw fail("invalid_path", `Not a document path: ${docPath}`);
    const [col, id] = parts;
    if (!SAFE.test(col) || !SAFE.test(id)) throw fail("invalid_path", `Unsafe path: ${docPath}`);
    return [col, id];
  }

  _file(docPath) {
    const [col, id] = this._split(docPath);
    return path.join(this.root, col, `${id}.json`);
  }

  get(docPath) {
    const file = this._file(docPath);
    try {
      return { exists: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch (e) {
      if (e.code === "ENOENT") return { exists: false, data: null };
      throw fail("read_failed", e.message);
    }
  }

  list(collection) {
    if (!SAFE.test(collection)) throw fail("invalid_path", `Unsafe collection: ${collection}`);
    const dir = path.join(this.root, collection);
    let names;
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw fail("read_failed", e.message);
    }
    const out = [];
    for (const n of names) {
      try {
        out.push({ id: n.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) });
      } catch { /* a half-written doc must not break the whole view */ }
    }
    return out;
  }

  // set replaces, update merges one level deep - same contract the brain assumes.
  write(docPath, patch, merge) {
    const [col] = this._split(docPath);
    const file = this._file(docPath);
    const next = merge ? { ...(this.get(docPath).data || {}), ...patch } : { ...patch };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, file);              // atomic: a crash never leaves a torn doc
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      if (e.code === "ENOSPC") throw fail("quota_exceeded", e.message);
      throw fail("write_failed", e.message);
    }
    this.emit("changed", { path: docPath, collection: col, data: next });
    return next;
  }

  remove(docPath) {
    const [col] = this._split(docPath);
    try { fs.unlinkSync(this._file(docPath)); } catch (e) {
      if (e.code !== "ENOENT") throw fail("write_failed", e.message);
    }
    this.emit("changed", { path: docPath, collection: col, data: null });
  }
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { Store };
