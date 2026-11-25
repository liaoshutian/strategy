import assert from 'node:assert/strict';
import {test} from 'node:test';
import {META,WIND_BANDS,SNAPSHOT,readCSV,stats,erp,pct,windowStart,zone,spreadBands} from './dist/core.mjs';
const csv='date,code,pe_ttm,bond10y_pct,close\n';
test('Snapshot values intact, and one observation is not ranked',()=>{
 assert.deepEqual(SNAPSHOT.map(x=>x.erp),[1.24,2.17,5.84]);assert.equal(stats([SNAPSHOT[0]],'2026-11-20').pct,null)
});
test('ERP uses percentage points and preserves negative output',()=>{
 assert.equal(erp(20,1.58),3.42);assert.equal(erp(50,3),-1)
});
test('Local import numeric unit, Excel codes, and stable chronological order',()=>{
 const parsed=readCSV('\uFEFF'+csv+'2026-11-20,000852.SH,40,1.5,5648\r\n2026-11-19,852,50,2.5,\r\n2026-11-20,300,20,1.5,4000');
 assert.deepEqual(parsed.map(r=>[r.date,r.code,r.erp,r.close]),[['2026-11-19','000852',-.5,null],['2026-11-20','000300',3.5,4000],['2026-11-20','000852',1,5648]]);
});
test('Rejects impossible dates, duplicate keys, bad yields, unmatched bond bases and zero P/E',()=>{
 assert.throws(()=>readCSV(csv+'2026-02-29,852,20,1.5,'),/日期/);
 assert.throws(()=>readCSV(csv+'2026-11-20,852,20,1.5,\n2026-11-20,852,20,1.5,'),/重复/);
 assert.throws(()=>readCSV(csv+'2026-11-20,852,20,1.5%,'),/百分数/);
 assert.throws(()=>readCSV(csv+'2026-11-20,852,20,1.5,\n2026-11-20,905,20,2.5,'),/同一国债/);
 assert.throws(()=>readCSV(csv+'2026-11-20,852,0,1.5,'),/正数/);
});
test('Percentile uses mid-rank; no future leakage even on a truncated view/window',()=>{
 const data=readCSV(csv+'2021-11-20,852,40,1.5,\n2026-11-19,852,50,1.5,\n2026-11-20,852,20,1.5,\n2026-11-21,852,20,1.5,\n2026-11-22,852,10,1.5,');
 assert.equal(stats(data,'2026-11-21').pct,75);
 assert.ok(Math.abs(stats(data,'2026-11-21',3).pct-200/3)<1e-9);
 assert.equal(stats(data,'2026-11-21',3).count,3);
 assert.equal(windowStart('2024-02-29',1),'2023-02-28');assert.equal(pct([2,2],2),50);
});
test('Threshold semantics and missing limits',()=>{
 assert.equal(zone(-.9,[-.9,.7]),'两线之间');assert.equal(zone(.7,[-.9,.7]),'达到机会线');assert.equal(zone(-1,[-.9,.7]),'低于危险线');assert.equal(zone(2,null),'未设阈值');
});
test('Sidebar bands use population dispersion and do not rank a single point',()=>{
 const b=spreadBands([1,2,3]);assert.equal(b.mean,2);assert.equal(b.min,1);assert.equal(b.max,3);
 assert.ok(Math.abs(b.plus-(2+Math.sqrt(2/3)))<1e-12);
 assert.ok(Math.abs(b.z-Math.sqrt(3/2))<1e-12);
 assert.equal(spreadBands([1]).z,null);assert.equal(spreadBands([2,2]).z,null);
});

test('Wind reference lines are present for all three indices, not data-derived',()=>{
 assert.deepEqual(META['000852'].levels,[-.90,.70]);
 assert.deepEqual(META['000905'].levels,[.32,2]);
 assert.deepEqual(META['000300'].levels,[4.07,6.03]);
 assert.deepEqual(Object.values(META).map(x=>x.median),[.09,1.24,5.24]);
 assert.equal(WIND_BANDS['000300'].minus,4.03);
});
