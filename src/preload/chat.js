"use strict";
// Chat bridge. Narrow on purpose: the chat window can ask, interrupt, reset,
// and open the brain - nothing else.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  ask(prompt, onMessage) {
    const id = Math.random().toString(36).slice(2);
    const listener = (_e, msg) => {
      if (msg.id !== id) return;
      onMessage(msg);
      if (msg.kind === "end") ipcRenderer.off("jarvis:stream", listener);
    };
    ipcRenderer.on("jarvis:stream", listener);
    return ipcRenderer.invoke("jarvis:ask", { id, prompt });
  },
  interrupt: () => ipcRenderer.send("jarvis:interrupt"),
  reset: () => ipcRenderer.send("jarvis:reset"),
  openBrain: () => ipcRenderer.send("brain:open"),
});
