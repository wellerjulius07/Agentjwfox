"use strict";
// The mcp capability, locally. One registry, server name -> tool name -> handler,
// keyed by exactly the names the brain calls: "Todoist" and "Google Calendar".

const { makeTodoist } = require("./todoist");
const { makeGcal } = require("./gcal");

function fail(code, message) {
  return Object.assign(new Error(message || code), { code, message: message || code });
}

function makeRegistry(env, timeZone) {
  const servers = {
    Todoist: makeTodoist({ token: env.TODOIST_API_TOKEN, timeZone }),
    "Google Calendar": makeGcal({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
      calendarId: env.GOOGLE_CALENDAR_ID || "primary",
    }),
  };

  return {
    servers: Object.keys(servers),
    tools: (server) => Object.keys(servers[server] || {}),
    async call(server, tool, input) {
      const s = servers[server];
      if (!s) throw fail("server_not_found", `Unknown server: ${server}`);
      const fn = s[tool];
      if (typeof fn !== "function") throw fail("not_in_manifest", `${server} has no tool ${tool}`);
      return fn(input || {});
    },
  };
}

module.exports = { makeRegistry };
