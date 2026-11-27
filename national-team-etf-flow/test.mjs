import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ratio,rolling,snapshot,flowProfile} from './dist/model.mjs';

test('滚动净申赎保留负值；基数缺失不制作百分比',()=>{
  assert.equal(rolling([10,-5,-2],2),-7);
  assert.equal(rolling([null,-2],2),null);
  assert.equal(rolling([4],2),null);
  assert.equal(ratio(-7,100),-7);
  assert.equal(ratio(1,0),null);
});
test('全历史峰值与窗口独立，周月使用最近 5 / 21 日净申赎',()=>{
  const dates=Array.from({length:30},(_,i)=>String(i+1));
  const holdings=dates.map((_,i)=>i===3?100:50);
  const s=snapshot({dates,holdings,flow:dates.map(()=>-2)});
  assert.equal(s.peakDate,'4');
  assert.equal(s.level,50);
  assert.equal(s.weekStrength,-10);
  assert.equal(s.monthStrength,-42);
  assert.equal(s.peak,100);
  assert.equal(ratio(s.peak,s.peak),100);
});
test('已发布数据同日对齐，整页可用',()=>{
  const load=name=>JSON.parse(readFileSync(new URL('./dist/data/'+name,import.meta.url)));
  const data=load('market.json');
  const snap=snapshot(data);
  assert.equal(snap.holdDates.at(-1),data.asOf);
  assert.equal(data.dates.at(-1),data.asOf);
  assert.equal(data.flow.length,data.dates.length);
  assert.ok(snap.level>0&&snap.level<=100);
  for(const [i] of data.indices.entries()){
    const rows=load('index-'+i+'.json');
    assert.equal(rows.length,data.dates.length);
    if(i===0) assert.deepEqual(rows.map(r=>r[0]),data.flow);
  }
  assert.equal(snap.peak,Math.max(...data.holdings.filter(Number.isFinite)));
});

test('分组、ETF、全篮子与两份交易日矩阵齐全并按索引对齐',()=>{
  const data=JSON.parse(readFileSync(new URL('./dist/data/market.json',import.meta.url)));
  assert.equal(data.schema,2);
  assert.equal(new Set(data.matrixOrder).size,data.funds.length);
  assert.deepEqual(new Set(data.matrixOrder),new Set(data.funds.map(f=>f[0])));
  assert.deepEqual(new Set(data.groups.map(g=>g[0])),new Set([...data.indices.slice(1),'全部']));
  assert.equal(data.groups.find(g=>g[0]==='全部')[1],data.funds.length);
  for (const f of data.funds) assert.ok(f[6].length===10&&f[6].every(x=>x.length===2));
  for (const g of data.groups) {
    assert.ok(g[9].length===10&&g[9].every(x=>x.length===2));
    assert.equal(g[1],g[0]==='全部'?data.funds.length:data.funds.filter(f=>f[7]===g[0]).length);
  }
});

test('点位分档按收盘价，红绿各自累计，忽略缺值，最高点纳入末档',()=>{
  const row=(f,cl)=>[f,125,160,100,cl];
  const p=flowProfile([row(15,110),row(-6,120),row(3,150),row(-2,200),
    row(null,110),row(100,null),row(100,201),row(0,180),[100]],100,200,2);
  assert.deepEqual(p.bins,[{low:100,high:150,buy:15,sell:6},{low:150,high:200,buy:3,sell:2}]);
  assert.equal(p.observed,5);
  assert.equal(p.maxAmount,21);
  assert.equal(flowProfile([[100],[null,120,130,110,125]],100,200).observed,0);
});

test('全区间或近期、不同指数的分档金额与有效日流水守恒',()=>{
  for(const id of [0,1,12]){
    const series=JSON.parse(readFileSync(new URL('./dist/data/index-'+id+'.json',import.meta.url)));
    for(const rows of [series,series.slice(-60)]){
      const valid=rows.filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[4]));
      assert.ok(valid.length);
      const {bins,observed}=flowProfile(rows,Math.min(...valid.map(r=>r[3])),Math.max(...valid.map(r=>r[2])));
      for(const [key,fn] of [['buy',f=>Math.max(0,f)],['sell',f=>Math.max(0,-f)]])
        assert.ok(Math.abs(bins.reduce((a,b)=>a+b[key],0)-valid.reduce((a,r)=>a+fn(r[0]),0))<1e-6);
      assert.equal(observed,valid.length);
    }
  }
});
