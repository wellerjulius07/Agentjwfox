"""Zieht Garmin-Gesundheitsdaten taeglich in eine lokale SQLite-DB. Kein LLM.

Erster Lauf (interaktiv, einmalig, ggf. mit MFA-Code):
    GARMIN_EMAIL=... python garmin_sync.py --backfill 365
Danach reichen die gespeicherten Tokens (~/.garminconnect), z.B. per systemd-Timer:
    python garmin_sync.py

Gespeichert wird das Roh-JSON pro Tag und Art. Auswerten per SQL, z.B.:
    SELECT day, json_extract(data, '$.restingHeartRate') FROM raw WHERE kind='summary';
"""

import argparse
import getpass
import json
import logging
import os
import sqlite3
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from garminconnect import Garmin

DB = Path(os.getenv("GARMIN_DB", "~/garmin.sqlite")).expanduser()
TOKENS = os.getenv("GARMINTOKENS", "~/.garminconnect")

KINDS = {
    "summary": lambda g, d: g.get_user_summary(d),
    "sleep": lambda g, d: g.get_sleep_data(d),
    "hrv": lambda g, d: g.get_hrv_data(d),
    "stress": lambda g, d: g.get_stress_data(d),
    "body_battery": lambda g, d: g.get_body_battery(d),
    "training_readiness": lambda g, d: g.get_training_readiness(d),
    "activities": lambda g, d: g.get_activities_by_date(d, d),
}


def days_to_sync(last: date | None, today: date, backfill: int) -> list[date]:
    # Der letzte gespeicherte Tag wird neu geholt: er war beim Sync evtl. noch nicht vorbei.
    start = last if last else today - timedelta(days=backfill - 1)
    return [start + timedelta(days=i) for i in range((today - start).days + 1)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", type=int, default=30, help="Tage beim allerersten Lauf")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    db = sqlite3.connect(DB)
    db.execute("CREATE TABLE IF NOT EXISTS raw (day TEXT, kind TEXT, data TEXT, PRIMARY KEY (day, kind))")

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD") or (getpass.getpass("Garmin-Passwort: ") if email else None)
    g = Garmin(email, password, prompt_mfa=lambda: input("MFA-Code: "))
    g.login(TOKENS)

    last = db.execute("SELECT max(day) FROM raw").fetchone()[0]
    ok = 0
    for d in days_to_sync(date.fromisoformat(last) if last else None, date.today(), args.backfill):
        day = d.isoformat()
        for kind, fetch in KINDS.items():
            try:
                data = fetch(g, day)
            except Exception as e:  # einzelne Art fehlt (z.B. Uhr ohne HRV) -> Rest trotzdem holen
                logging.warning("%s %s: %s", day, kind, e)
                continue
            if data:
                db.execute("INSERT OR REPLACE INTO raw VALUES (?, ?, ?)", (day, kind, json.dumps(data)))
                ok += 1
            time.sleep(1)  # ponytail: feste Pause gegen Rate-Limits, anpassen falls 429
        db.commit()
        logging.info("%s fertig", day)
    return 0 if ok else 1  # nichts geholt -> Exit 1, damit OnFailure= alarmiert


if __name__ == "__main__":
    sys.exit(main())
