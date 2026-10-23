"""Plant jeden Sonntagabend 3 Laeufe fuer die kommende Woche in freie Kalender-Luecken. Kein LLM.

Regeln (siehe ROADMAP.md, Spezifikation 39):
  - Block 1:15, Fenster Mo-Fr 18:00-21:00, Sa/So 17:00-20:00, Do erst ab 18:30 (nach dem Gym)
  - Tage in dieser Reihenfolge: Fr, Sa, So, Do, Mi (Mi = locker). Mo und Di nie (Beintag).
  - Moeglichst nicht an zwei Tagen hintereinander
  - Schon eingetragene Laeufe zaehlen mit, ein zweiter Lauf am selben Tag wird nie geplant

Einrichtung:
    pip install google-api-python-client google-auth-oauthlib
    credentials.json (Google Cloud Console, OAuth-Client "Desktop") nach ~/.config/plan_runs/
    OAuth-Zustimmungsbildschirm auf "In Produktion" stellen, sonst laeuft das Token nach 7 Tagen ab
    ssh -L 8080:localhost:8080 minipc   # vom Laptop, dann auf dem Mini-PC:
    python plan_runs.py                 # einmal interaktiv, URL im Laptop-Browser oeffnen -> token.json

Push-Nachricht: NTFY_TOPIC setzen, sonst nur Ausgabe auf stdout.
"""

import os
import urllib.request
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
RUN = timedelta(minutes=75)
STEP = timedelta(minutes=15)
RUNS_PER_WEEK = 3
TITLE = "Lauf (Zone 2)"
# Wochentag (Mo=0) -> Fenster; Reihenfolge = Prioritaet
WINDOWS = {
    4: (time(18), time(21)),
    5: (time(17), time(20)),
    6: (time(17), time(20)),
    3: (time(18, 30), time(21)),
    2: (time(18), time(21)),
}
LOCKER = {2}
DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

CONF = Path(os.getenv("PLAN_RUNS_CONF", "~/.config/plan_runs")).expanduser()
SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def free_slot(day: date, busy: list[tuple[datetime, datetime]]) -> datetime | None:
    lo, hi = WINDOWS[day.weekday()]
    t, end = datetime.combine(day, lo, TZ), datetime.combine(day, hi, TZ)
    while t + RUN <= end:
        if all(t + RUN <= b0 or t >= b1 for b0, b1 in busy):
            return t
        t += STEP
    return None


def plan(monday: date, busy: list[tuple[datetime, datetime]], run_days: set[date]) -> list[datetime]:
    """Gibt die Startzeiten der neu zu planenden Laeufe zurueck."""
    chosen = set(run_days)
    out = []
    for avoid_neighbours in (True, False):
        for wd in WINDOWS:
            if len(chosen) >= RUNS_PER_WEEK:
                return out
            day = monday + timedelta(days=wd)
            if day in chosen:
                continue
            if avoid_neighbours and {day - timedelta(days=1), day + timedelta(days=1)} & chosen:
                continue
            slot = free_slot(day, busy)
            if slot:
                chosen.add(day)
                out.append(slot)
    return out


def calendar():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    token = CONF / "token.json"
    creds = Credentials.from_authorized_user_file(str(token), SCOPES) if token.exists() else None
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CONF / "credentials.json"), SCOPES)
            creds = flow.run_local_server(port=8080, open_browser=False)
        token.write_text(creds.to_json())
        token.chmod(0o600)
    return build("calendar", "v3", credentials=creds)


def notify(msg: str) -> None:
    print(msg)
    if topic := os.getenv("NTFY_TOPIC"):
        urllib.request.urlopen(f"https://ntfy.sh/{topic}", data=msg.encode(), timeout=10)


def main() -> None:
    today = date.today()
    monday = today + timedelta(days=7 - today.weekday())
    lo = datetime.combine(monday, time(), TZ)
    cal = calendar()
    events = cal.events().list(
        calendarId="primary", timeMin=lo.isoformat(), timeMax=(lo + timedelta(days=7)).isoformat(),
        singleEvents=True, maxResults=250,
    ).execute().get("items", [])

    busy, run_days = [], set()
    for e in events:
        # ponytail: ganztaegige und als "frei" markierte Termine blockieren nicht
        if "dateTime" not in e.get("start", {}) or e.get("transparency") == "transparent":
            continue
        s, t = datetime.fromisoformat(e["start"]["dateTime"]), datetime.fromisoformat(e["end"]["dateTime"])
        busy.append((s, t))
        if e.get("summary", "").startswith("Lauf"):
            run_days.add(s.astimezone(TZ).date())

    new = sorted(plan(monday, busy, run_days))
    for s in new:
        title = "Lauf (locker)" if s.weekday() in LOCKER else TITLE
        cal.events().insert(calendarId="primary", body={
            "summary": title,
            "start": {"dateTime": s.isoformat(), "timeZone": "Europe/Berlin"},
            "end": {"dateTime": (s + RUN).isoformat(), "timeZone": "Europe/Berlin"},
        }).execute()

    total = len(run_days) + len(new)
    lines = [f"{DAYS[s.weekday()]} {s:%d.%m. %H:%M}" for s in new]
    msg = "Laeufe diese Woche: " + (", ".join(lines) if lines else "nichts Neues eingetragen")
    if total < RUNS_PER_WEEK:
        msg += f"\nACHTUNG: nur {total} von {RUNS_PER_WEEK} Laeufen passen, Woche bitte selbst planen."
    notify(msg)


if __name__ == "__main__":
    main()
