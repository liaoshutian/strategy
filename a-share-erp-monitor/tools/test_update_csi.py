from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from update_csi import BOND_URL, CODES, CURVE, PE_URL, day, get_bonds, read_history, refresh


class RefreshTests(unittest.TestCase):
    end = date(2026, 11, 25)

    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "data" / "csi.csv"
        self.days = [date(2026, 11, d) for d in (20, 23, 24)]
        self.missing_bond = None
        self.missing_index = None
        self.dup = False
        self.bad = False

    def feed(self, url, **p):
        if url == PE_URL:
            a, b, code = day(p["startDate"]), day(p["endDate"]), p["indexCode"]
            rows = [{"tradeDate": d.strftime("%Y%m%d"), "indexCode": code,
                     "peg": "13.09" if not self.bad else None, "close": 3954.57}
                    for d in self.days if a <= d <= b and self.missing_index != (code, d)]
            if rows and self.dup:
                rows += rows[:1]
            return {"code": "200", "data": rows}
        self.assertEqual(url, BOND_URL)
        self.assertEqual((p["drawingType"], p["curveType"], p["curveName"]), (1, 1, CURVE))
        a, b = day(p["startTime"]), day(p["endTime"])
        self.assertLess((b - a).days, 14)
        mapping = {d.isoformat(): [{"termYear": "5.00", "rate": "1.2"}, {"termYear": "10.00", "rate": "1.5780"}]
                   for d in self.days if a <= d <= b and d != self.missing_bond}
        return {"data": {"errcode": 0, "data": {"date": str(b), "yieldCurveMap": mapping}}}

    def run_refresh(self, start=None, end=None):
        return refresh(self.path, end or self.end, start, self.feed)

    def test_bootstrap_and_idempotence(self):
        self.assertTrue(self.run_refresh())
        content = self.path.read_bytes()
        rows = read_history(self.path)
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[(self.days[0], CODES[0])], ("13.09", "1.578", "3954.57"))
        self.assertFalse(self.run_refresh())
        self.assertEqual(content, self.path.read_bytes())

    def test_append_and_keep_old(self):
        self.run_refresh()
        self.days.append(self.end)
        self.assertTrue(self.run_refresh())
        self.assertEqual(len(read_history(self.path)), 12)

    def test_holiday_is_no_change(self):
        self.run_refresh()
        self.assertFalse(self.run_refresh(self.end + timedelta(days=3), self.end + timedelta(days=4)))

    def test_missing_yield_keeps_file(self):
        self.run_refresh()
        before = self.path.read_bytes()
        self.missing_bond = self.days[-1]
        with self.assertRaisesRegex(ValueError, "missing same-day"):
            self.run_refresh()
        self.assertEqual(before, self.path.read_bytes())

    def test_partial_duplicate_and_invalid(self):
        self.missing_index = CODES[0], self.days[-1]
        with self.assertRaisesRegex(ValueError, "dates disagree"):
            self.run_refresh()
        self.missing_index = None
        self.dup = True
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.run_refresh()
        self.dup = False
        self.bad = True
        with self.assertRaisesRegex(ValueError, "numeric"):
            self.run_refresh()
        self.assertFalse(self.path.exists())

    def test_expected_overlap_and_backfill_bound(self):
        self.run_refresh()
        self.days.pop()
        with self.assertRaisesRegex(ValueError, "previously recorded"):
            self.run_refresh()
        with self.assertRaisesRegex(ValueError, "366"):
            self.run_refresh(date(2015, 1, 5))

    def test_makeup_weekend_not_an_a_share_session(self):
        self.days.insert(0, date(2026, 10, 11))
        self.missing_bond = self.days[0]
        self.assertTrue(self.run_refresh())
        self.assertEqual(len(read_history(self.path)), 9)

    def test_wrong_source_date(self):
        with self.assertRaisesRegex(ValueError, "out-of-range"):
            get_bonds(self.end, self.end, lambda *_a, **_kw: {"data": {"errcode": 0,
                "data": {"yieldCurveMap": {"2026-11-26": []}}}})
