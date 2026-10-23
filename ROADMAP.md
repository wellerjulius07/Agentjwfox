# Automation Roadmap

## Ziel

Die Prototypen sollen auf dem Mini-PC, der dauerhaft läuft, automatisiert werden.
Das soll **ohne Agenten-Usage** gehen: Skripte laufen auf festen Zeitplänen,
ein LLM kommt nur dort zum Einsatz, wo wirklich ein Urteil gebraucht wird.

**Prinzip:** Alles, was deterministisch ist, wird ein Skript und kostet 0 Usage.
Ein LLM bekommt nur fertige Ergebnisse oder Änderungen zu sehen, gebündelt und selten
(z.B. 1× pro Woche).

## Bestand
| Projekt          | Status    | Automationskandidaten (ohne LLM)                              |
|------------------|-----------|---------------------------------------------------------------|
| Money Simulator  | Prototyp  | Nächtliche Exportläufe, Kurse per API ziehen, Vergleich zum Vortag |
| Semester Cortex  | Prototyp  | Fristen-/Termin-Erinnerungen, Kalender-Sync (ICS)              |
| kcal dot         | Prototyp  | Tages-/Wochensummen, Erinnerung bei fehlendem Eintrag          |
| Tagesform        | Prototyp  | Tägliche Check-in-Erinnerung, Verlauf aggregieren              |
| Fitness Tracker  | Prototyp  | Datenimport, Wochenstatistik                                   |
| Garmin-Daten     | Sync da   | `garmin/`: 2× täglich Schlaf, HRV, Stress, Body Battery, Readiness, Aktivitäten → SQLite. Quelle für Tagesform und Fitness Tracker |

## Querschnitt (Mini-PC)
- Zeitplan: systemd-Timer statt cron (`Persistent=true` holt Läufe nach, die während einer Downtime verpasst wurden, und es gibt Logs über journald)
- Fehler-Alarm: `OnFailure=` → Push-Nachricht (ntfy oder Telegram-Bot)
- Backups: nächtlich alle Projektdaten (restic/rsync)
- Heartbeat: Mini-PC meldet sich täglich, Alarm bleibt bei Ausfall nicht aus
- Wochenreport: Python-Skript erzeugt HTML/Markdown aus allen 5 Projekten (kein LLM)
- Optional LLM: 1× pro Woche kommentiert ein Modell den fertigen Report (API mit kleinem Modell, Kosten im Cent-Bereich)

## Phase 0 – Bestandsaufnahme
- [ ] Wo liegen die 5 Prototypen (Repo, Sprache, Datenformat)?
- [ ] Wiederkehrende Aufgaben sammeln (was, wie oft, wie lange dauert es)
- [ ] Nach Aufwand × Häufigkeit priorisieren
- [ ] Beteiligte Tools/Konten auflisten (Mail, Kalender, Tasks, APIs …)

## Phase 1 – Quick Wins
- [ ] Top-1-Aufgabe automatisieren, manuell auslösbar
- [ ] Ergebnis eine Woche lang prüfen

## Phase 2 – Zeitgesteuert
- [ ] Quick Wins auf Zeitplan stellen (täglich/wöchentlich)
- [ ] Benachrichtigung bei Fehlern

## Phase 3 – Ereignisgesteuert
- [ ] Auf Ereignisse reagieren (neue Mail, neuer Termin, Webhook)
- [ ] Mehrere Schritte verketten

## Phase 4 – Ausbau
- [ ] Nächste Aufgaben aus Phase 0 nachziehen
- [ ] Laufende Automationen regelmäßig ausmisten

## Backlog / Ideen
- 
