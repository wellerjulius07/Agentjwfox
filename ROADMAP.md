# Automation Roadmap

## Ziel

Die Prototypen und der Alltag werden auf dem Mini-PC automatisiert, der dauerhaft läuft.
Das soll **ohne Agenten-Usage** gehen: Skripte laufen auf festen Zeitplänen, ein LLM nur dort,
wo wirklich ein Urteil gebraucht wird.

**Fokus derzeit:** Den Alltag geschafft bekommen, ohne den Sport zu vernachlässigen.
Sport ist gesetzt, alles andere plant sich darum herum.

**Prinzip:** Was deterministisch ist, wird ein Skript (0 Usage). Was nativ geht
(Kalender, Gmail-Filter), braucht gar keinen Code.

**Arbeitsweise:** Ideen sammeln → priorisieren → erst auf ausdrückliches Go bauen.

## Bestand
| Projekt          | Status                         |
|------------------|--------------------------------|
| Semester Cortex  | Prototyp                       |
| kcal dot         | Prototyp                       |
| Tagesform        | Prototyp                       |
| Money Simulator  | Prototyp                       |
| Fitness Tracker  | Prototyp                       |
| Garmin-Daten     | Sync-Entwurf in `garmin/` (Entscheidung, ob er bleibt, offen) |

## Stufe 1 – sofort spürbar
- [x] **39 Trainingszeiten im Kalender reservieren** (Spezifikation unten; Skript in `training/`, Einrichtung auf dem Mini-PC offen)
- [ ] **29 Morgenbriefing:** eine Push-Nachricht mit Terminen, Top-3-Aufgaben, Training heute und Garmin-Werten (enthält 1)
- [ ] **13 Erinnerung an Fristen** (Semester Cortex, 7/3/1 Tag vorher)
- [ ] **32 Todoist-Aufräumen:** Überfälliges gesammelt auf heute, dazu ein Wochenrückblick
- [ ] **16 Fehler-Alarm:** Push-Nachricht, wenn ein Skript fehlschlägt

## Stufe 2 – entlastet weiter
- [ ] 5 Garmin-Aktivitäten automatisch in den Fitness Tracker
- [ ] 31 Erinnerung zur Schlafenszeit, abgeleitet vom ersten Termin am nächsten Morgen
- [ ] 2 Frühwarnung bei Krankheit (HRV fällt, Ruhepuls steigt)
- [ ] 22 Moodle/ILIAS: neue Materialien laden und Push-Nachricht schicken
- [ ] 28 Gmail-Filter für Uni, Rechnungen, Newsletter (nativ, kein Code)

## Stufe 3 – später
- Garmin: 3 Tagesform vorausfüllen, 4 kcal-Tagesziel an Aktivität anpassen, 6 Trends, 7 Zusammenhänge
- Money Simulator: 8 nächtliche Exportläufe, 9 Kurse per API, 10 Alarm bei Abweichung, 11 Monats-Snapshots, 12 Szenarien
- Uni: 14 Vorlesungsplan in den Kalender, 15 Prüfungs-Countdown, 23 neue Noten, 24 Karteikarten-Erinnerung
- Geld: 25 Kontoauszüge kategorisieren, 26 Abo-Kündigungsfristen, 27 Rechnungen nach Drive
- Alltag: 30 Regen- und Bahn-Warnung, 33 Notion-Journal, 34 Müll-ICS (nativ), 35 Ordner sortieren, 36 Preisalarm, 37 Paket-Tracking, 38 Discover Weekly archivieren
- Mini-PC: 18 Heartbeat, 19 Wochenreport, 20 lokales Dashboard

Gestrichen: 17 Backup, 21 LLM-Wochenkommentar.

## Spezifikation 39 – Trainingszeiten
Alle Termine landen im Hauptkalender (Google, Gmail-Konto).

**Gym** – wiederkehrende Termine, nativ ohne Skript (✅ angelegt ab 26.10.2026):
| Tag | Zeit          | Inhalt                        |
|-----|---------------|-------------------------------|
| Mo  | 17:00–18:15   | Oberkörper, Rücken            |
| Di  | 17:00–18:15   | Beine                         |
| Do  | 17:00–18:15   | Oberkörper, Arme, Rücken      |

**Läufe** – Skript, sonntagabends für die kommende Woche:
- 3 Läufe, Block je 1:15 (ca. 50 min Zone 2 plus Umziehen und Duschen)
- Fenster: Mo–Fr 18:00–21:00, Sa/So 17:00–20:00
- Reihenfolge der Tage: Fr, Sa, So → Do (frühestens 18:30, nach dem Gym) → Mi (nur locker). Montag nie, wegen Beintag am Dienstag.
- Möglichst nicht an zwei Tagen hintereinander
- Nur in freie Lücken; bestehende Termine haben Vorrang
- Danach eine Push-Nachricht mit den Lauf-Terminen; Warnung, wenn keine 3 Lücken frei sind
