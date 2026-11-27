"""Read numerical observations from the upstream report, never its HTML/JS as code."""
import argparse
from datetime import date, datetime
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import tempfile
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SOURCE = "https://wwww1998.github.io/national-team-etf-flow/"
DATA = Path(__file__).resolve().parents[1] / "dist" / "data"
MAX_BYTES = 8_000_000


def exported(page, name):
    matches = re.findall(rf"(?m)^\s*(?:const|var) {name}\s*=\s*(\[.*\]);\s*$", page)
    if len(matches) != 1:
        raise ValueError(f"缺失或重复的源字段: {name}")
    return json.loads(matches[0])


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_dates(dates):
    if not dates or dates != sorted(set(dates)):
        raise ValueError("日期必须唯一且递增")
    current = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    canonical = all(date.fromisoformat(d).isoformat() == d and
                    date.fromisoformat(d).weekday() < 5 for d in dates)
    if not canonical or date.fromisoformat(dates[-1]) > current:
        raise ValueError("存在非交易日标签或未来日期")


class Tables(HTMLParser):
    def __init__(self, page):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None
        self.feed(page)

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def details(page, dates):
    tables = Tables(page).tables
    summary = next((t for t in tables if t and t[0][:2] == ["品种", "最新份额(亿)"]), None)
    matrix = next((t for t in tables if t and len(t[0]) == 11 and t[0][0] == "品种"), None)
    if summary is None or matrix is None:
        raise ValueError("缺失品种汇总或逐日明细表")
    if matrix[0][1:] != [d[5:] for d in dates[-10:]]:
        raise ValueError("逐日明细交易日未对齐")
    rows, daily = [], {}
    code_re = re.compile(r"(\d{6})$")
    for row in matrix[1:]:
        if len(row) == 11 and row[0] != "合计":
            if row[0] in daily:
                raise ValueError("逐日品种重复")
            daily[row[0]] = [float(m[1].replace(",", "")) if
                               (m := re.match(r"([+-]?[\d,.]+)亿", s)) else None for s in row[1:]]
    for row in summary[1:]:
        match = code_re.search(row[0]) if row else None
        if not match or len(row) < 5:
            continue
        code = match[1]
        key = row[0][:match.start()].strip()
        label = key[1:].strip()
        # The upstream classifies 159949 correctly as 创业板, but labels its manager incorrectly.
        label = (re.split(r"2025末汇金持仓|2026\.10救市", label)[0].strip()
                 if code != "159949" else "创业板50ETF 华安")
        vals = [float(s.replace(",", "")) if re.fullmatch(r"[+\-\d.,]+", s) else None for s in row[1:5]]
        if key not in daily or vals[0] is None or vals[0] < 0 or not label:
            raise ValueError(f"缺失或无效的品种字段: {code}")
        rows.append([code, label, *vals, daily[key]])
    if not 20 <= len(rows) <= 100 or len({row[0] for row in rows}) != len(rows):
        raise ValueError("品种数量异常或重复")
    return rows


def extract(page):
    holding, dates, names, quotes, flows = (exported(page, item) for item in
                                          ("YPT", "DATA_D", "IDX_NAMES", "IDX_K", "IDX_Q"))
    validate_dates(dates)
    published = re.findall(r"数据日\s*<b>(\d{8})</b>", page)
    if len(published) != 1 or published[0] != dates[-1].replace("-", ""):
        raise ValueError("展示数据日与时间序列不一致")
    if not 1 <= len(names) <= 40 or names[0] != "中证全指" or len(set(names)) != len(names):
        raise ValueError("指数标识异常")
    if len(names) != len(quotes) or len(names) != len(flows):
        raise ValueError("指数序列数量不一致")
    hold_days = [x["d"] for x in holding]
    if len(holding) < 200 or hold_days != dates[-len(holding):]:
        raise ValueError("持仓历史不足或未与资金流日期对齐")
    values = [x["v"] for x in holding]
    if any(not number(v) or v < 0 for v in values) or values[-1] <= 0:
        raise ValueError("持仓值无效")
    index = {}
    for name, quote, flow in zip(names, quotes, flows):
        if len(name) > 40 or len(quote) != len(dates) or len(flow) != len(dates):
            raise ValueError(f"指数数据未对齐: {name}")
        if not all(number(n) for n in flow):
            raise ValueError(f"净申赎无效: {name}")
    # Store full index history using compact positional rows, with explicit OHLC gaps.
    for i, (quote, flow) in enumerate(zip(quotes, flows)):
        items = []
        for j, q in enumerate(quote):
            if q is None:
                items.append([flow[j]])
                continue
            o, h, l, c = (q[k] for k in ("o", "h", "l", "c"))
            if (q["d"] != dates[j].replace("-", "") or not all(number(v) and v > 0 for v in (o,h,l,c))
                    or l > min(o,c) or h < max(o,c)):
                raise ValueError(f"K线无效: {names[i]} {dates[j]}")
            items.append([flow[j], o, h, l, c])
        index[i] = items
    return {
        "schema": 1, "source": SOURCE, "asOf": dates[-1], "dates": dates,
        "holdings": [v if v > 0 else None for v in values],
        "funds": details(page, dates), "indices": names, "flow": flows[0],
    }, index


def serialize(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"


def update(page, out):
    market, index = extract(page)
    pinned = out / "market.json"
    if pinned.exists():
        old = json.loads(pinned.read_text(encoding="utf-8"))
        if old["asOf"] > market["asOf"] or not set(old["dates"]).issubset(market["dates"]):
            raise ValueError("上游回退或缩短历史，保留原有数据")
        if [r[0] for r in old["funds"]] != [r[0] for r in market["funds"]]:
            if {r[0] for r in old["funds"]} != {r[0] for r in market["funds"]}:
                raise ValueError("样本篮子变更，审核历史及比较口径后再更新")
        if old["indices"] != market["indices"]:
            raise ValueError("指数口径变更，须先审查")
        old_values = dict(zip(old["dates"][-len(old["holdings"]):], old["holdings"]))
        new_values = dict(zip(market["dates"][-len(market["holdings"]):], market["holdings"]))
        if any(v is not None and new_values.get(d) is None for d,v in old_values.items()):
            raise ValueError("持仓历史出现新缺口，保留原有数据")
    out.mkdir(parents=True, exist_ok=True)
    files = {f"index-{i}.json": rows for i, rows in index.items()}
    files["market.json"] = market
    with tempfile.TemporaryDirectory(dir=out) as staging:
        for name, value in files.items():
            (Path(staging) / name).write_text(serialize(value), encoding="utf-8")
        for name in files:
            (Path(staging) / name).replace(out / name)
    print(f'数据日 {market["asOf"]}，最长 {len(market["holdings"])} 行，{len(market["funds"])} 只 ETF')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="本地已保存的上游报表（验证用）")
    parser.add_argument("--out", type=Path, default=DATA)
    args = parser.parse_args()
    if args.input:
        body = args.input.read_bytes()
    else:
        with urlopen(Request(SOURCE, headers={"User-Agent": "strategy-etf-dashboard/1.0"}), timeout=40) as stream:
            if stream.geturl() != SOURCE or stream.headers.get_content_type() != "text/html":
                raise ValueError("非预期源地址或内容类型")
            body = stream.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("源报表异常过大")
    update(body.decode("utf-8"), args.out)


if __name__ == "__main__":
    main()
