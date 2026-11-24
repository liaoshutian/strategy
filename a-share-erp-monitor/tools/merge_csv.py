#!/usr/bin/env python3
"""Join locally exported index and sovereign-yield CSVs by trade date."""
import argparse
import csv
import re
import sys
from datetime import date
from decimal import Decimal, InvalidOperation

CODES = {'000300','000905','000852'}
LABELS = {'沪深300':'000300','中证500':'000905','中证1000':'000852'}

def rows(path):
    with open(path, newline='', encoding='utf-8-sig') as source:
        for n, r in enumerate(csv.DictReader(source), 2):
            yield n, {k.strip().lower(): (v or '').strip() for k, v in r.items() if k is not None}

def col(row, *keys, optional=False):
    for k in keys:
        if k in row and row[k] != '':
            return row[k]
    if optional:
        return ''
    raise ValueError(f'缺少 {keys[0]} 列或数值')

def day(s):
    s = s.strip().replace('/', '-')
    if re.fullmatch(r'\d{8}', s):
        s = f'{s[:4]}-{s[4:6]}-{s[6:]}'
    elif re.fullmatch(r'\d{4}-\d{1,2}-\d{1,2}', s):
        y,m,d = map(int, s.split('-'))
        return date(y,m,d).isoformat()
    return date.fromisoformat(s).isoformat()

def number(s, *, positive=False):
    try:
        v = Decimal(s.removesuffix('%'))
    except InvalidOperation as e:
        raise ValueError('无效数值') from e
    if not v.is_finite() or (positive and v <= 0):
        raise ValueError('无效数值：需为有限值，PE 和收盘点位须大于零')
    return format(v.normalize(), 'f') if v else '0'

def run(index, bond, output):
    rates = {}; matched = []; skipped = 0
    for n,r in rows(bond):
        try:
            d = day(col(r,'date','日期','交易日期'))
            y = number(col(r,'bond10y_pct','10年期国债收益率','十年期国债收益率','10年'))
            if d in rates:
                raise ValueError('国债日期重复')
            rates[d] = y
        except ValueError as e:
            raise ValueError(f'{bond}:{n} {e}') from e
    seen = set()
    for n,r in rows(index):
        try:
            d = day(col(r,'date','日期','交易日期'))
            raw = col(r,'code','指数代码','指数').upper().removesuffix('.SH').removesuffix('.CSI')
            code = LABELS.get(raw, raw.zfill(6))
            if code not in CODES:
                raise ValueError(f'不支持指数 {raw}')
            key = d, code
            if key in seen:
                raise ValueError('同日同指数重复')
            seen.add(key)
            pe = col(r,'pe_ttm','滚动市盈率','市盈率ttm','pe(ttm)',optional=True)
            px = col(r,'close','收盘','收盘价','收盘点位',optional=True)
            if not pe or d not in rates:
                skipped += 1
                continue
            matched.append((d,code,number(pe,positive=True),rates[d],number(px,positive=True) if px else ''))
        except ValueError as e:
            raise ValueError(f'{index}:{n} {e}') from e
    if not matched:
        raise ValueError('没有同日且估值有效的数据；未写出文件')
    with open(output, 'x', newline='', encoding='utf-8-sig') as target:
        writer = csv.writer(target)
        writer.writerow(('date','code','pe_ttm','bond10y_pct','close'))
        writer.writerows(sorted(matched))
    print(f'已匹配 {len(matched)} 行；另有 {skipped} 行缺市盈率或缺当日国债，未填补。', file=sys.stderr)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('index_csv')
    p.add_argument('bond_csv')
    p.add_argument('output_csv',help='必须是新文件，以免覆盖原数据')
    try:
        a = p.parse_args()
        run(a.index_csv, a.bond_csv, a.output_csv)
    except (ValueError,OSError) as e:
        p.exit(2,f'{e}\n')
