import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WINDOWS,ratio,sma,rolling,snapshot} from './dist/model.mjs';

test('均线只使用完整交易日窗口；缺值不会补零',()=>{
  assert.deepEqual(sma([2,4,null,6,8],2),[null,3,null,null,7]);
  for(const n of WINDOWS){
    const v=Array.from({length:205},(_,i)=>i+1);
    const actual=sma(v,n);
    assert.equal(actual[n-2],null);
    assert.equal(actual[n-1],(n+1)/2);
    assert.equal(actual.at(-1),(206+205-n)/2);
  }
});
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
  assert.deepEqual(s.baselines.map(r=>r[0]),['MA10','MA20','MA30','MA60','MA200','历史峰值']);
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
  assert.ok(snap.baselines.every(r=>r[0]&&r[1]>0&&r[2]>0));
});
