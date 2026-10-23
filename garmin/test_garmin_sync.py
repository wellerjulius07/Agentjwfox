from datetime import date

from garmin_sync import days_to_sync

today = date(2026, 10, 23)
assert days_to_sync(None, today, 3) == [date(2026, 10, 21), date(2026, 10, 22), today]
assert days_to_sync(date(2026, 10, 22), today, 30) == [date(2026, 10, 22), today]
assert days_to_sync(today, today, 30) == [today]
print("ok")
