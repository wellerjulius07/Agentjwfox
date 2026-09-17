"use strict";
// Google Calendar over plain fetch. No googleapis dependency: this needs three
// endpoints, and a refresh-token grant is a dozen lines.
//
// The brain reads events in Google's own shape (start.dateTime | start.date,
// end, summary, description, status, id) but expects them under payload.events,
// which is what the claude.ai connector returned - so items get renamed here.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3";

function fail(code, message) {
  return Object.assign(new Error(message || code), { code, message: message || code });
}

function makeGcal({ clientId, clientSecret, refreshToken, calendarId = "primary" }) {
  let access = null;
  let expires = 0;

  async function token() {
    if (!clientId || !clientSecret || !refreshToken) {
      throw fail("server_not_connected", "Google OAuth credentials are not set");
    }
    if (access && Date.now() < expires - 60_000) return access;
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret,
          refresh_token: refreshToken, grant_type: "refresh_token",
        }),
      });
    } catch (e) {
      throw fail("server_unavailable", e.message);
    }
    if (!res.ok) throw fail("needs_reauth", `Token refresh failed: ${res.status}`);
    const j = await res.json();
    access = j.access_token;
    expires = Date.now() + (j.expires_in || 3600) * 1000;
    return access;
  }

  async function call(pathname, { method = "GET", body, query } = {}) {
    const url = new URL(`${CAL}${pathname}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await token()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw fail("server_unavailable", e.message);
    }
    if (res.status === 401) { access = null; throw fail("needs_reauth", "Google rejected the token"); }
    if (res.status === 403) throw fail("blocked_by_policy", "Google refused the request");
    if (res.status === 429) throw fail("rate_limited", "Google rate limit");
    if (!res.ok) throw fail("tool_error", `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    return res.json();
  }

  const id = () => encodeURIComponent(calendarId);

  return {
    async list_events({ startTime, endTime, orderBy = "startTime", pageSize = 100, timeZone } = {}) {
      const j = await call(`/calendars/${id()}/events`, {
        query: {
          timeMin: startTime, timeMax: endTime, orderBy,
          maxResults: pageSize, timeZone,
          singleEvents: true,   // required for orderBy=startTime, and expands recurrences
        },
      });
      return { events: j.items || [] };
    },

    async create_event({ summary, startTime, endTime, timeZone, description }) {
      const ev = await call(`/calendars/${id()}/events`, {
        method: "POST",
        body: {
          summary, description,
          start: { dateTime: startTime, timeZone },
          end: { dateTime: endTime, timeZone },
        },
      });
      return { event: ev, id: ev.id };
    },

    // The brain moves an event by start alone and expects the duration to follow,
    // so the original length is read back and reapplied.
    async update_event({ eventId, startTime, endTime, timeZone, summary, description }) {
      const body = {};
      if (summary !== undefined) body.summary = summary;
      if (description !== undefined) body.description = description;

      if (startTime) {
        body.start = { dateTime: startTime, timeZone };
        if (endTime) {
          body.end = { dateTime: endTime, timeZone };
        } else {
          const old = await call(`/calendars/${id()}/events/${encodeURIComponent(eventId)}`);
          const from = old.start?.dateTime, to = old.end?.dateTime;
          const len = from && to ? new Date(to) - new Date(from) : 60 * 60 * 1000;
          body.end = { dateTime: new Date(new Date(startTime).getTime() + len).toISOString(), timeZone };
        }
      }

      const ev = await call(`/calendars/${id()}/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH", body,
      });
      return { event: ev, id: ev.id };
    },
  };
}

module.exports = { makeGcal };
