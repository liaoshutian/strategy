#!/usr/bin/env bash
# All Pages deployments use the same allowlisted repository layout.
set -euo pipefail
out="${1:-site}"
mkdir -p "$out"
for project in a-share-erp-monitor national-team-etf-flow; do
  mkdir -p "$out/$project/dist/data"
  # No source tools, credentials or dotfiles included in the Pages artifact.
  for file in "$project"/dist/*.html "$project"/dist/*.css "$project"/dist/*.mjs; do
    [[ ! -f "$file" ]] || cp "$file" "$out/$project/dist/"
  done
  for file in "$project"/dist/data/*.csv "$project"/dist/data/*.json; do
    [[ ! -f "$file" ]] || cp "$file" "$out/$project/dist/data/"
  done
done
test -s "$out/a-share-erp-monitor/dist/index.html"
test -s "$out/a-share-erp-monitor/dist/data/csi.csv"
test -s "$out/national-team-etf-flow/dist/index.html"
test -s "$out/national-team-etf-flow/dist/data/market.json"
cat > "$out/index.html" <<'HTML'
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>策略看板</title></head>
<body style="margin:1.5rem;font:1rem/1.6 system-ui"><main><h1 style="font-size:1.4rem">策略看板</h1><ul>
<li><a href="./a-share-erp-monitor/dist/">A 股风险溢价看板</a></li>
<li><a href="./national-team-etf-flow/dist/">宽基 ETF 持仓水位</a></li>
</ul></main></body></html>
HTML
