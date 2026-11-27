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


NUM = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
TAGS = ("2025末汇金持仓", "2026.10救市")


def table_number(value):
    if value in ("", "—", "-", "–"):
        return None
    if not re.fullmatch(NUM, value):
        raise ValueError(f"表格数字格式变化: {value!r}")
    return float(value.replace(",", ""))


def daily_cell(value):
    if value in ("", "—", "-", "–"):
        return [None, None]
    match = re.fullmatch(rf"({NUM})(亿)?\s*(?:({NUM})倍)?", value)
    if not match or (not match[2] and float(match[1].replace(",", "")) != 0):
        raise ValueError(f"逐日金额或倍量格式变化: {value!r}")
    return [table_number(match[1]), table_number(match[3] or "")]


def details(page, dates, names):
    tables = Tables(page).tables
    find = lambda head: next((t for t in tables if t and t[0][:len(head)] == head), None)
    summary = find(["品种", "最新份额(亿)"])
    group_summary = find(["指数类别", "今日", "近一周", "近一月",
                          "2025-12-31份额(亿)", "2025-12-31市值(亿)"])
    day_keys = [d[5:] for d in dates[-10:]]
    matrix = find(["品种", *day_keys])
    group_matrix = find(["指数类别", *day_keys])
    if any(t is None for t in (summary, group_summary, matrix, group_matrix)):
        raise ValueError("缺失汇总或明细数据，或近十个交易日未对齐")

    def matrix_rows(table):
        out = {}
        for row in table[1:]:
            if len(row) == 1:
                continue
            if len(row) != 11 or row[0] in out:
                raise ValueError("明细表列数错误或标的重复")
            out[row[0]] = [daily_cell(s) for s in row[1:]]
        return out

    daily, group_daily = matrix_rows(matrix), matrix_rows(group_matrix)
    rows, code_by_key, category = [], {}, None
    for row in summary[1:]:
        if len(row) == 1:
            group = re.fullmatch(r"(.+?)\s*·\s*\d+只", row[0])
            if not group or group[1] not in names[1:]:
                raise ValueError(f"未知分组: {row[0]}")
            category = group[1]
            continue
        match = re.fullmatch(r"([沪深])(.+?)(\d{6})", row[0])
        if not match or len(row) != 6 or not category:
            raise ValueError("基金汇总行格式变化")
        exchange, name, code = match.groups()
        key = row[0][:-6].strip()
        tag = next((v for v in TAGS if name.endswith(v)), None)
        label = name.removesuffix(tag).strip() if tag else name.strip()
        # Keep the established correction for this ticker's upstream manager label.
        if code == "159949":
            label = "创业板50ETF 华安"
        vals = [table_number(s) for s in row[1:5]]
        if key not in daily or vals[0] is None or vals[0] < 0 or not label:
            raise ValueError(f"缺失或无效的品种字段: {code}")
        code_by_key[key] = code
        rows.append([code, label, *vals, daily[key], category, exchange, tag])
    if not 20 <= len(rows) <= 100 or len({row[0] for row in rows}) != len(rows) or daily.keys() != code_by_key.keys():
        raise ValueError("品种数量异常、重复或汇总与明细不匹配")

    groups = []
    names_seen = set()
    for row in group_summary[1:]:
        if len(row) != 9:
            raise ValueError("指数汇总行列数变化")
        key = row[0]
        match = next(((name, int(m[1])) for name in names[1:]
                      if (m := re.fullmatch(re.escape(name) + r"\s*(\d+)只", key))), None)
        all_match = re.fullmatch(r"全部[（(](\d+)类\s*(\d+)只[）)]", key)
        if all_match:
            category, count = "全部", int(all_match[2])
            if int(all_match[1]) != len(names) - 1 or count != len(rows):
                raise ValueError("篮子总计数量不一致")
        elif match:
            category, count = match
            if category not in names[1:] or count != sum(r[7] == category for r in rows):
                raise ValueError(f"指数归集与基金汇总不匹配: {key}")
        else:
            raise ValueError(f"未知指数汇总: {key}")
        if key not in group_daily or category in names_seen:
            raise ValueError("指数明细缺失或类别重复")
        names_seen.add(category)
        groups.append([category, count, *[table_number(s) for s in row[1:8]], group_daily[key]])
    if names_seen != set(names[1:]) | {"全部"} or len(group_daily) != len(groups):
        raise ValueError("指数汇总/明细与指数 K 线分类不匹配")
    return rows, groups, [code_by_key[key] for key in daily]

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
    funds, groups, matrix_order = details(page, dates, names)
    stamp = re.findall(r"更新时间\s*<b>(\d{4}-\d{2}-\d{2} \d{2}:\d{2})</b>", page)
    if len(stamp) != 1 or datetime.fromisoformat(stamp[0]).date() < date.fromisoformat(dates[-1]):
        raise ValueError("缺失更新时间或早于数据日")
    return {
        "schema": 2, "source": SOURCE, "asOf": dates[-1], "sourceUpdatedAt": stamp[0], "dates": dates,
        "holdings": [v if v > 0 else None for v in values],
        "funds": funds, "groups": groups, "matrixOrder": matrix_order, "indices": names, "flow": flows[0],
    }, index


def serialize(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"


def update(page, out):
    market, index = extract(page)
    pinned = out / "market.json"
    old = None
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
    if (old is not None and old.get("sourceUpdatedAt") and
            {k: v for k, v in old.items() if k != "sourceUpdatedAt"} ==
            {k: v for k, v in market.items() if k != "sourceUpdatedAt"} and
            all((out / name).is_file() and
                (out / name).read_text(encoding="utf-8") == serialize(value)
                for name, value in files.items())):
        market["sourceUpdatedAt"] = old["sourceUpdatedAt"]
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
