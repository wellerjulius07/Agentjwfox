"use strict";
// Todoist, shaped the way the brain already reads it.
//
// The brain was written against the claude.ai Todoist connector, so get-overview
// has to answer in that connector's shape, not in Todoist REST's. Specifically it
// reads: projects[].{id,name}, sections[].{id,name,sectionOrder},
// tasks[].{id,content,description,checked,isUncompletable,sectionId,dueDate,
// labels,priority:"p1".."p4",recurring,children[].checked}.

const API = "https://api.todoist.com/rest/v2";

function fail(code, message) {
  return Object.assign(new Error(message || code), { code, message: message || code });
}

async function call(pathname, { method = "GET", body, token } = {}) {
  if (!token) throw fail("server_not_connected", "TODOIST_API_TOKEN is not set");
  let res;
  try {
    res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw fail("server_unavailable", e.message);
  }
  if (res.status === 401 || res.status === 403) throw fail("needs_reauth", "Todoist rejected the token");
  if (res.status === 429) throw fail("rate_limited", "Todoist rate limit");
  if (!res.ok) throw fail("tool_error", `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  if (res.status === 204) return null;
  return res.json();
}

// REST priority is inverted: 4 is urgent, 1 is none.
const prio = (p) => `p${5 - Math.min(4, Math.max(1, p || 1))}`;

// The brain slices dueDate as [0,10) = date and [11,16) = time, so a datetime has
// to arrive as a local "YYYY-MM-DDTHH:MM..." string, not as a Z-stamped UTC one.
function dueString(due, tz) {
  if (!due) return null;
  if (!due.datetime) return due.date || null;
  const d = new Date(due.datetime);
  if (Number.isNaN(d.getTime())) return due.date || null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
}

// Todoist wants RFC3339 with an offset, but the brain hands over naive local
// datetimes ("2026-09-18T14:00:00"). Attach the offset that Berlin actually had
// on that date, so a DST boundary does not shift the task by an hour.
function offsetFor(datum, tz) {
  const probe = new Date(Date.UTC(+datum.slice(0, 4), +datum.slice(5, 7) - 1, +datum.slice(8, 10), 12));
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(probe).map((x) => [x.type, x.value]),
  );
  const min = Math.round(
    (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - probe.getTime()) / 6e4,
  );
  const a = Math.abs(min);
  return `${min >= 0 ? "+" : "-"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

const rfc3339 = (v, tz) =>
  /[Zz]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}${offsetFor(v.slice(0, 10), tz)}`;

function shapeTask(t, tz, kids) {
  return {
    id: String(t.id),
    content: t.content,
    description: t.description || "",
    checked: !!t.is_completed,
    isUncompletable: false,
    projectId: String(t.project_id),
    sectionId: t.section_id ? String(t.section_id) : null,
    parentId: t.parent_id ? String(t.parent_id) : null,
    dueDate: dueString(t.due, tz),
    labels: t.labels || [],
    priority: prio(t.priority),
    recurring: !!t.due?.is_recurring,
    children: kids,
  };
}

function makeTodoist({ token, timeZone }) {
  return {
    // The brain calls this twice: once bare (to find the project) and once with
    // projectId (to get that project's sections and tasks).
    async "get-overview"({ projectId } = {}) {
      const projects = await call("/projects", { token });
      const shapedProjects = projects.map((p) => ({ id: String(p.id), name: p.name }));
      if (!projectId) return { projects: shapedProjects };

      const [sections, tasks] = await Promise.all([
        call(`/sections?project_id=${encodeURIComponent(projectId)}`, { token }),
        call(`/tasks?project_id=${encodeURIComponent(projectId)}`, { token }),
      ]);

      const byParent = new Map();
      for (const t of tasks) {
        if (!t.parent_id) continue;
        const k = String(t.parent_id);
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k).push({ id: String(t.id), checked: !!t.is_completed });
      }

      return {
        projects: shapedProjects,
        sections: sections.map((s, i) => ({
          id: String(s.id), name: s.name, sectionOrder: s.order ?? i,
        })),
        // Subtasks stay nested under their parent only; top level is what the brain lists.
        tasks: tasks
          .filter((t) => !t.parent_id)
          .map((t) => shapeTask(t, timeZone, byParent.get(String(t.id)) || [])),
      };
    },

    async "add-tasks"({ tasks }) {
      const made = [];
      for (const t of tasks || []) {
        made.push(await call("/tasks", {
          method: "POST", token,
          body: {
            content: t.content,
            description: t.description || undefined,
            project_id: t.projectId || undefined,
            section_id: t.sectionId || undefined,
            labels: t.labels || undefined,
            due_datetime: t.date && t.date.length > 10 ? rfc3339(t.date, timeZone) : undefined,
            due_date: t.date && t.date.length === 10 ? t.date : undefined,
          },
        }));
      }
      return { created: made.map((t) => ({ id: String(t.id), content: t.content })) };
    },

    async "complete-tasks"({ ids }) {
      for (const id of ids || []) await call(`/tasks/${id}/close`, { method: "POST", token });
      return { ok: true };
    },

    async "uncomplete-tasks"({ ids }) {
      for (const id of ids || []) await call(`/tasks/${id}/reopen`, { method: "POST", token });
      return { ok: true };
    },

    // The brain relies on a bare date clearing an existing time. REST honours that
    // when due_date is sent alone, so pass exactly one of the two through.
    async "reschedule-tasks"({ tasks }) {
      for (const t of tasks || []) {
        const body = String(t.date).length > 10
          ? { due_datetime: rfc3339(String(t.date), timeZone) }
          : { due_date: t.date };
        await call(`/tasks/${t.id}`, { method: "POST", token, body });
      }
      return { ok: true };
    },
  };
}

module.exports = { makeTodoist };
