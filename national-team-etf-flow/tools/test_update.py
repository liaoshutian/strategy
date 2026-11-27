from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from update import daily_cell, exported, update, validate_dates


class UpdateTests(unittest.TestCase):
    def test_unexpected_shape_and_no_execution(self):
        self.assertEqual(exported('const YPT=[{"d":"2026-11-26","v":1}];', 'YPT')[0]["v"], 1)
        with self.assertRaises(ValueError):
            exported("const YPT=[alert(1)];", "YPT")
        with self.assertRaises(ValueError):
            exported("const YPT=[];\nconst YPT=[];", "YPT")

    def test_amount_and_multiple_are_independent_and_zero_is_not_missing(self):
        for src, expected in (
            ("0+131.83倍", [0, 131.83]),
            ("0+0.00倍", [0, 0]),
            ("-2.43亿-7.48倍", [-2.43, -7.48]),
            ("+1,000.00亿", [1000, None]),
            ("—", [None, None]),
        ):
            self.assertEqual(daily_cell(src), expected)
        with self.assertRaises(ValueError):
            daily_cell("123倍")

    def test_bad_dates(self):
        for dates in (["2026-11-27", "2026-11-26"], ["2026-11-26"] * 2, ["2026-11-21"]):
            with self.assertRaises(ValueError):
                validate_dates(dates)

    def test_missing_source_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            baseline = out / "market.json"
            baseline.write_text("previous")
            with self.assertRaises(ValueError):
                update("<html>not ready</html>", out)
            self.assertEqual(baseline.read_text(), "previous")

    def test_repeat_is_idempotent_and_bad_history_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            market = {"dates": ["2026-11-25", "2026-11-26"], "asOf": "2026-11-26",
                      "funds": [["510300"]], "holdings": [40, 42], "indices": ["中证全指"]}
            with patch("update.extract", return_value=(market, {0: [[0], [1]]})):
                update("", out)
                first = {p.name:p.read_bytes() for p in out.iterdir()}
                update("", out)
            self.assertEqual({p.name:p.read_bytes() for p in out.iterdir()}, first)
            for bad in ({**market, "dates": ["2026-11-26"]}, {**market, "holdings": [None, 42]},
                        {**market, "funds": [["510330"]]}, {**market, "asOf": "2026-11-25"}):
                with patch("update.extract", return_value=(bad, {0: [[1]]})), self.assertRaises(ValueError):
                    update("", out)
                self.assertEqual({p.name:p.read_bytes() for p in out.iterdir()}, first)
