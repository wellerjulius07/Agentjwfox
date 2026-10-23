from datetime import date, datetime

from plan_runs import TZ, plan

mon = date(2026, 11, 2)


def at(d, h, m=0):
    return datetime(2026, 11, d, h, m, tzinfo=TZ)


gym = [(at(d, 17), at(d, 18, 15)) for d in (2, 3, 5)]

# Leere Woche: Fr, So, dann Mi (Sa/Do waeren Nachbartage)
assert [s.day for s in plan(mon, gym, set())] == [6, 8, 4]
# Fr-Abend belegt -> Sa, Do (nicht vor 18:30), dann So als Nachbar im zweiten Durchgang
got = plan(mon, gym + [(at(6, 18), at(6, 21))], set())
assert got == [at(7, 17), at(5, 18, 30), at(8, 17)], got
# Termin schiebt den Lauf nach hinten: So 17:00-17:30 belegt -> 17:30
assert plan(mon, gym + [(at(8, 17), at(8, 17, 30))], set())[1] == at(8, 17, 30)
# Bereits 2 Laeufe eingetragen -> nur noch einer, nie am selben Tag
got = plan(mon, gym, {date(2026, 11, 6), date(2026, 11, 8)})
assert len(got) == 1 and got[0].day not in (6, 8)
# Alles voll -> nichts
assert plan(mon, [(at(2, 0), at(9, 0))], set()) == []
print("ok")
