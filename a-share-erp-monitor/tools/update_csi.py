#!/usr/bin/env python3
"""Fetch CSI index valuation and AMAC-hosted CSI Treasury yield; atomically update a CSV."""
import argparse
import csv
import io
import json
import os
import random
import re
import tempfile
import time
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

CODES = ("000300", "000852", "000905")
FIELDS = ("date", "code", "pe_ttm", "bond10y_pct", "close")
PE_URL = "https://www.csindex.com.cn/csindex-home/perf/index-perf"
BOND_URL = "https://www.amac.org.cn/portal/dataIndex/securities/yield/getYieldCurveData"
CURVE = "Treasury Bond Term Structure"
EARLIEST = date(2015, 1, 5)
OUT = Path(__file__).resolve().parents[1] / "dist" / "data" / "csi.csv"


def download(url, **params):
    req = Request(url + "?" + urlencode(params), headers={
        "Accept": "application/json", "User-Agent": "strategy-erp-monitor/1.0",
        "Referer": "https://www.csindex.com.cn/" if url == PE_URL else "https://www.amac.org.cn/",
    })
    for attempt in range(3):
        try:
            with urlopen(req, timeout=18) as response:
                payload = response.read(4_000_001)
            if len(payload) > 4_000_000:
                raise ValueError("oversized upstream response")
            return json.loads(payload)
        except (OSError, ValueError) as exc:
            if attempt == 2:
                raise ValueError(f"{url}: {exc}") from exc
            time.sleep(2 ** attempt + random.random())


def day(value):
    if not re.fullmatch(r"\d{4}-?\d{2}-?\d{2}", str(value)):
        raise ValueError(f"Invalid date: {value!r}")
    return date.fromisoformat(str(value).replace("-", ""))


def decimal(value, lo, hi):
    try:
        num = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise ValueError(f"Invalid numeric field: {value!r}") from exc
    if not num.is_finite() or not Decimal(lo) <= num <= Decimal(hi):
        raise ValueError(f"Numeric field out of range: {value!r}")
    return format(num.normalize(), "f") if num else "0"


def add_unique(mapping, key, val):
    if key in mapping:
        raise ValueError(f"Duplicate observation: {key}")
    mapping[key] = val


def get_index(code, start, end, get):
    data = get(PE_URL, indexCode=code, startDate=start.strftime("%Y%m%d"),
               endDate=end.strftime("%Y%m%d"))
    if str(data.get("code")) != "200" or not isinstance(data.get("data"), list):
        raise ValueError(f"CSI {code}: bad API response")
    result = {}
    for row in data["data"]:
        dt = day(row["tradeDate"])
        if not start <= dt <= end:
            raise ValueError(f"CSI {code}: out-of-range date {dt}")
        if row.get("indexCode") not in (None, "", code):
            raise ValueError(f"CSI {code}: unexpected index code")
        add_unique(result, dt, (decimal(row["peg"], ".001", "1000000"),
                                decimal(row["close"], ".001", "10000000")))
    return result


def get_bonds(start, end, get):
    result = {}
    while start <= end:
        stop = min(start + timedelta(days=13), end)
        data = get(BOND_URL, drawingType=1, curveType=1, curveName=CURVE,
                   startTime=start.strftime("%Y%m%d"), endTime=stop.strftime("%Y%m%d"))
        wrap = data["data"]
        if str(wrap.get("errcode")) != "0":
            raise ValueError("AMAC: bad API response")
        curves = wrap["data"]["yieldCurveMap"]
        if not isinstance(curves, dict):
            raise ValueError("AMAC: expected date-keyed yieldCurveMap")
        for key, curve in curves.items():
            dt = day(key)
            if not start <= dt <= stop:
                raise ValueError(f"AMAC: out-of-range date {dt}")
            # Date key is the observation date; the top-level date is not each observation.
            candidates = [r["rate"] for r in curve if Decimal(str(r["termYear"])) == 10]
            if len(candidates) != 1:
                raise ValueError(f"AMAC {dt}: expected exactly one 10-year yield")
            add_unique(result, dt, decimal(candidates[0], "-10", "25"))
        start = stop + timedelta(days=1)
        time.sleep(.2)
    return result


def read_history(path):
    if not path.exists():
        return {}
    result = {}
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or []) != FIELDS:
            raise ValueError("unexpected existing CSV header")
        for row in reader:
            dt, code = day(row["date"]), row["code"]
            if code not in CODES:
                raise ValueError(f"unexpected existing index {code}")
            add_unique(result, (dt, code), (decimal(row["pe_ttm"], ".001", "1000000"),
                       decimal(row["bond10y_pct"], "-10", "25"),
                       decimal(row["close"], ".001", "10000000")))
    for dt in {key[0] for key in result}:
        legs = [result[(dt, code)][1] for code in CODES if (dt, code) in result]
        if len(legs) != 3 or len(set(legs)) != 1:
            raise ValueError(f"incomplete or conflicting existing data: {dt}")
    return result


def refresh(path, end, requested_start=None, get=download):
    old = read_history(path)
    last = max((d for d, _ in old), default=None)
    if last and last > end and requested_start is None:
        raise ValueError("existing history is newer than requested end")
    start = requested_start or max(EARLIEST, last - timedelta(days=9) if last else end - timedelta(days=44))
    if not EARLIEST <= start <= end or (end - start).days > 366:
        raise ValueError("choose a start from 2015-01-05 and within 366 days of end per run")
    # Chunk both sources; a long manual backfill does not assume one unlimited response.
    prices = {code: {} for code in CODES}
    cursor = start
    while cursor <= end:
        stop = min(end, cursor + timedelta(days=89))
        for code in CODES:
            prices[code].update(get_index(code, cursor, stop, get))
        cursor = stop + timedelta(days=1)
    keys = [set(series) for series in prices.values()]
    if any(k != keys[0] for k in keys):
        raise ValueError("CSI index dates disagree; refusing a partial day")
    bonds = get_bonds(start, end, get)
    days = keys[0]
    expected_overlap = {d for d, _ in old if start <= d <= end}
    if expected_overlap - days:
        raise ValueError("CSI is missing previously recorded sessions")
    if not days:
        if not old or bonds:
            raise ValueError("no index observations; not writing an empty or stale file")
        return False
    if days - bonds.keys():
        raise ValueError("AMAC missing same-day yield: " + ", ".join(str(d) for d in sorted(days - bonds.keys())))
    if len(days) < 3 and not old:
        raise ValueError("bootstrap returned fewer than three complete sessions")
    result = dict(old)
    for dt in days:
        for code in CODES:
            pe, close = prices[code][dt]
            result[(dt, code)] = (pe, bonds[dt], close)
    if result == old:
        return False
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(FIELDS)
    writer.writerows((dt.isoformat(), code, *result[(dt, code)]) for dt, code in sorted(result))
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, encoding="utf-8",
                                     newline="", delete=False) as handle:
        tmp = Path(handle.name)
        try:
            handle.write(output.getvalue())
            handle.flush()
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
    print(f"{len(result)} observations; latest session: {max(d for d, _ in result)}")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=day)
    parser.add_argument("--end", type=day)
    parser.add_argument("--output", type=Path, default=OUT)
    a = parser.parse_args()
    today = datetime.now(ZoneInfo("Asia/Shanghai"))
    # Both markets publish after close; manual daytime checks don't request an in-flight day.
    cutoff = today.date() - timedelta(days=today.hour < 19)
    end = a.end or cutoff
    if end > cutoff:
        parser.error("end is after the most recent eligible China date (19:00 cutoff)")
    try:
        if not refresh(a.output, end, a.start):
            print("No changes; retained the last valid CSV.")
    except (ValueError, KeyError, TypeError, InvalidOperation) as exc:
        parser.exit(1, f"Refresh rejected: {exc}\n")


if __name__ == "__main__":
    main()
