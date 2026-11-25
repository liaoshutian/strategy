import {META,SNAPSHOT,WIND,WIND_BANDS,readCSV,stats,windowStart,zone,spreadBands} from './core.mjs?v=wind-compare-2';
const $=id=>document.getElementById(id), codes=Object.keys(META).sort((a,b)=>['000852','000905','000300'].indexOf(a)-['000852','000905','000300'].indexOf(b));
const storeKey='cn-erp-monitor-v1', cv=$('plot'), ctx=cv.getContext('2d');
const fmt=(x,n=2)=>Number.isFinite(x)?x.toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
const unit=(x,u,n)=>Number.isFinite(x)?fmt(x,n)+u:'—';
const safeJSON=(s,fallback)=>{try{return JSON.parse(s)||fallback}catch{return fallback}};
const get=k=>{try{return localStorage.getItem(k)}catch{return null}};
const put=(k,v)=>{try{localStorage.setItem(k,v);return true}catch{return false}};
let csiRows=null,csvRows=null;
let raw=get(storeKey+'-source'), rows=SNAPSHOT, mode='wind', savedLevels=safeJSON(get(storeKey+'-levels'),{});
if(raw)try{rows=csvRows=readCSV(raw);mode='csv'}catch{raw=null}
let focus=codes.find(c=>rows.some(r=>r.code===c))||codes[0], compare=false, prices=false, sample=0, filter=0, hover=-1, drag=null, cursorX=0, cursorY=0;
let dates=[], grouped={}, a=0,b=0, visible=[], plotted=[], geom={};
function limits(code){const taken=savedLevels?.[mode]?.[code];return Array.isArray(taken)&&taken.length===2&&taken.every(Number.isFinite)&&taken[0]<taken[1]?taken:(mode==='wind'?META[code].levels:null)}
function msg(t='',error=false){$('statusText').textContent=t;$('statusText').toggleAttribute('data-error',error)}
function setRange(start,end){
  const last=dates.length-1,span=Math.min(Math.max(end-start,1),last);
  a=Math.max(0,Math.min(last-span,Math.round(start)));b=a+span; hover=-1;
}
function regroup(){
  grouped=Object.fromEntries(codes.map(c=>[c,rows.filter(r=>r.code===c)]));
  visible=compare?codes.filter(c=>grouped[c].length):[focus];
  dates=[...new Set(rows.filter(r=>visible.includes(r.code)).map(r=>r.date))].sort();
  if(filter<0)filter=0;
  const first=windowStart(dates.at(-1),filter);
  const start=dates.findIndex(d=>d>=first);
  a=Math.max(start,0);b=dates.length-1;hover=-1;
}
function syncPicker(){
  const s=$('source');s.querySelector('[value=csi]').disabled=!csiRows;
  s.querySelector('[value=csv]').disabled=!csvRows;s.value=mode;
}
function setMode(nextMode,next){
  rows=next;mode=nextMode;syncPicker();
  if(!rows.some(r=>r.code===focus))focus=codes.find(c=>rows.some(r=>r.code===c));
  compare=false;prices=false;filter=0;sample=0;$('sample').value='0';regroup();render()
}
function threshold(which,value){
  if(!Number.isFinite(value)){renderControls();return}
  const pair=(limits(focus)||[-1,1]).slice();
  const capped=Math.max(-20,Math.min(20,Math.round(value*100)/100));
  pair[which]=which===0?Math.min(capped,Math.round((pair[1]-.01)*100)/100):Math.max(capped,Math.round((pair[0]+.01)*100)/100);
  savedLevels[mode]??={};savedLevels[mode][focus]=pair;
  put(storeKey+'-levels',JSON.stringify(savedLevels));render()
}
function renderControls(){
  const l=limits(focus),p=l||[-1,1];
  for(const [id,x] of [['lo',p[0]],['hi',p[1]]]){
    $(id).value=String(x);$(id+'N').value=l?String(x):'';
  }
  $('thresholdTitle').textContent=META[focus].name+'阈值';
  $('levelsNote').textContent=l?(mode==='wind'?'原图参考线已预置；改动滑块只影响本浏览器，不影响中证数据。':'这是当前指数的自定义阈值。'): '当前数据源未预置该指数阈值。拖动任一滑块设定一组自定义值。';
}
function rowStats(c){
  const s=stats(grouped[c],dates[b],sample);
  if(mode==='wind'&&s.last)return {...s,pct:s.last.sourcePct,median:META[c].median};
  return s
}
function renderReadouts(){
  const s=rowStats(focus),r=s.last,l=limits(focus);
  const band=mode==='wind'?WIND_BANDS[focus]:spreadBands(grouped[focus].filter(x=>x.date>=windowStart(dates[b],sample)&&x.date<=dates[b]).map(x=>x.erp));
  const pp=v=>unit(v,' pp');
  const items=[
    ['风险溢价',pp(r?.erp),'emph'],['盈利收益率',unit(r?.ey,'%')],['10 年国债',unit(r?.bond,'%')],
    [mode==='wind'?'原图分位':'样本分位',unit(s.pct,'%',2)],
    ['危险线',pp(l?.[0]),'danger'],['中位数',pp(s.median)],['机会线',pp(l?.[1]),'chance'],
    ['指数点位',fmt(r?.close)],['最大 / 最小',Number.isFinite(band.max)?fmt(band.max)+' / '+fmt(band.min)+' pp':'—'],
    ['平均值',pp(band.mean)],['±1 标准差',Number.isFinite(band.plus)?fmt(band.plus)+' / '+fmt(band.minus)+' pp':'—'],
    ['Z 分数',fmt(band.z)]
  ];
  $('chartReadouts').innerHTML=items.map(([name,value,cls=''])=>'<div class="'+cls+'"><dt>'+name+'</dt><dd>'+value+'</dd></div>').join('');
}
function render(){
  const n=dates.length;
  $('dataset').textContent=mode==='wind'?'Wind 原图快照 · 2026-11-20':mode==='csi'?'中证重算 · '+rows.at(-1).date:'本地 CSV · '+rows.length.toLocaleString('zh-CN')+' 行';
  $('windChart').hidden=mode!=='wind';
  $('viewTitle').textContent=compare?'三指数风险溢价叠加':META[focus].name+'风险溢价';
  $('viewSub').textContent=mode==='wind'?'仅内置 11 月 20 日的 Wind 原图读数。原图历史曲线请点上方链接；未取得逐日 Wind 数据，不以其他来源补齐。':dates[0]+' 至 '+dates.at(-1)+(mode==='csi'?' · '+grouped[focus].length+' 个交易日 · 中证滚动 PE 与中证国债；分位不是原图的近十年分位。':' · 本地导入，不自动更新');
  $('compare').setAttribute('aria-pressed',compare);$('price').setAttribute('aria-pressed',prices);
  $('price').disabled=!grouped[focus].some(r=>r.close!=null);$('sample').disabled=mode==='wind';
  $('clear').hidden=mode!=='csv';$('dates').hidden=n<2;
  for(const el of $('presets').querySelectorAll('button')){el.disabled=n<2;el.setAttribute('aria-pressed',filter===Number(el.dataset.years))}
  for(const id of ['start','end']){$(id).min=dates[0];$(id).max=dates.at(-1)}
  $('start').value=dates[a];$('end').value=dates[b];$('zoomIn').disabled=n<3||b-a<=2;$('zoomOut').disabled=n<2||a===0&&b===n-1;
  $('cards').innerHTML=codes.map(c=>{
    const s=rowStats(c),r=s.last;
    return '<button type="button" class="card" data-code="'+c+'" aria-pressed="'+(c===focus)+'" '+(!grouped[c].length?'disabled':'')+'><span class="label">'+META[c].name+' · '+c+'</span><strong class="mono">'+unit(r?.erp,' pp')+'</strong><span class="label">'+(mode==='wind'?'Wind 原图分位 ':'历史分位 ')+unit(s.pct,'%',1)+'</span><span class="label">'+(r?r.date+' · '+zone(r.erp,limits(c)):'无同口径数据')+'</span></button>'
  }).join('');
  $('rows').innerHTML=codes.map(c=>{
    const s=rowStats(c),r=s.last;return '<tr><td>'+META[c].name+'</td><td>'+(r?.date||'—')+'</td><td>'+fmt(r?.pe)+'</td><td>'+unit(r?.ey,'%')+'</td><td>'+unit(r?.bond,'%')+'</td><td>'+unit(r?.erp,' pp')+'</td><td>'+unit(s.pct,'%',2)+(mode==='wind'?'（原图）':(s.count?'（'+s.count+' 日）':''))+'</td></tr>'
  }).join('');
  const items=visible.map(c=>[META[c].name,{'000852':'#087f97','000905':'#245db2','000300':'#aa640b'}[c]]);if(prices&&rows.some(r=>r.code===focus&&r.close!=null))items.push([META[focus].name+'点位（右轴）','#7354a4']);if(limits(focus))items.push([META[focus].name+'阈值线','#84efbc']);
  $('legend').innerHTML=items.map(([label,color])=>'<span class="key"><i class="dot" style="--c:'+color+'"></i>'+label+'</span>').join('');
  renderReadouts();renderControls(); draw()
}
function label(v,x,y,color='#506776',align='left'){ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(v,x,y)}
function draw(){
  const W=cv.clientWidth,H=cv.clientHeight;if(!W||!H)return;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.font='12px system-ui,sans-serif';ctx.lineJoin='round';
  const x0=W<420?39:51,x1=W-(prices?62:16),y0=23,y1=H-36,start=dates[a],end=dates[b],single=a===b;
  const l=limits(focus),m=rowStats(focus).median;
  plotted=rows.filter(r=>visible.includes(r.code)&&r.date>=start&&r.date<=end);
  const values=plotted.map(r=>r.erp).concat(l||[],m===null?[]:[m],0).filter(Number.isFinite);
  let low=Math.min(...values),high=Math.max(...values); const pad=Math.max((high-low)*.1,.12); low-=pad;high+=pad;
  const y=v=>y1-(v-low)*(y1-y0)/(high-low);
  const day=date=>Date.parse(date)/864e5, DX=day(end)-day(start);
  const x=(d,c)=>single?x0+(x1-x0)/2:x0+(day(d)-day(start))*(x1-x0)/DX;
  const priceRows=plotted.filter(r=>r.code===focus&&r.close!=null), ps=priceRows.map(r=>r.close);
  let pl=ps.length?Math.min(...ps):0,ph=ps.length?Math.max(...ps):1;if(pl===ph){pl-=1;ph+=1}
  const py=v=>y1-(v-pl)/(ph-pl)*(y1-y0);
  geom={x0,x1,y0,y1,y,low,high,x,day,start,end};
  if(l){ctx.fillStyle='#1292610d';ctx.fillRect(x0,y0,x1-x0,Math.max(0,y(l[1])-y0));ctx.fillStyle='#be32310d';ctx.fillRect(x0,y(l[0]),x1-x0,Math.max(0,y1-y(l[0])))}
  for(let i=0;i<=5;i++){
    const yy=y0+i*(y1-y0)/5;ctx.beginPath();ctx.strokeStyle='#dce5e7';ctx.lineWidth=1;ctx.moveTo(x0,yy+.5);ctx.lineTo(x1,yy+.5);ctx.stroke();
    label(fmt(high-i*(high-low)/5,1),x0-7,yy+4,'#506776','right');
    if(prices&&ps.length)label(fmt(ph-i*(ph-pl)/5,0),x1+4,yy+4,'#7354a4');
  }
  const grid=single?[a]:[...new Set(Array.from({length:Math.min(W<480?4:6,b-a+1)},(_,i)=>Math.round(a+i*(b-a)/(Math.min(W<480?4:6,b-a+1)-1))))];
  for(const i of grid){
    const xx=single?x0+(x1-x0)/2:x(dates[i],focus);
    label(single?start:(W<540?dates[i].slice(2):dates[i]),xx,y1+23,'#506776',i===a&&!single?'left':i===b&&!single?'right':'center')
  }
  function hline(value,color){
    if(!Number.isFinite(value))return;
    ctx.beginPath();ctx.setLineDash([6,5]);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.moveTo(x0,y(value));ctx.lineTo(x1,y(value));ctx.stroke();ctx.setLineDash([])
  }
  // Area to zero, like the reference chart; gaps and single-day snapshots are not filled.
  if(visible.length===1&&!single){
    let group=[];
    const fill=()=>{
      if(group.length>1){
        const first=group[0],last=group.at(-1);
        ctx.beginPath();ctx.moveTo(x(first.date),y(0));
        for(const p of group)ctx.lineTo(x(p.date),y(p.erp));
        ctx.lineTo(x(last.date),y(0));ctx.closePath();ctx.fillStyle='#57b8c276';ctx.fill();
      }
      group=[];
    };
    for(const p of plotted){if(group.length&&day(p.date)-day(group.at(-1).date)>7)fill();group.push(p)}
    fill();
  }
  hline(0,'#94a7ad');hline(m,'#71808c');if(l){hline(l[0],'#ad3033');hline(l[1],'#0d8058')}
  function series(pts,c,get,color){
    ctx.lineWidth=2;ctx.strokeStyle=color;ctx.fillStyle=color;const maxGapDays=7;
    let previous=null;
    for(const p of pts){
      const xx=x(p.date,c),yy=get(p);
      if(single||pts.length===1){ctx.beginPath();ctx.arc(xx,yy,6,0,Math.PI*2);ctx.fill()}
      else if(previous&&day(p.date)-day(previous.date)<=maxGapDays){ctx.beginPath();ctx.moveTo(x(previous.date,c),get(previous));ctx.lineTo(xx,yy);ctx.stroke()}
      else{ctx.beginPath();ctx.arc(xx,yy,2.4,0,Math.PI*2);ctx.fill()}
      previous=p
    }
  }
  const colors={'000852':'#087f97','000905':'#245db2','000300':'#aa640b'};
  for(const c of visible)series(plotted.filter(r=>r.code===c),c,r=>y(r.erp),colors[c]);
  if(prices)series(priceRows,focus,r=>py(r.close),'#7354a4');
  if(hover>=a&&hover<=b){
    const date=dates[hover], sel=plotted.filter(r=>r.date===date), hx=single?cursorX:x(date,focus);
    if(!single){ctx.strokeStyle='#506776';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(hx,y0);ctx.lineTo(hx,y1);ctx.stroke()}
    for(const p of sel){ctx.beginPath();ctx.fillStyle=colors[p.code];ctx.arc(x(p.date,p.code),y(p.erp),4,0,2*Math.PI);ctx.fill()}
    const tp=$('tip');tp.textContent=date+'  '+sel.map(p=>META[p.code].name+' '+unit(p.erp,' pp')+(prices&&p.code===focus&&p.close!=null?' / '+fmt(p.close,2):'')).join(' · ');
    // Measure after revealing, then keep the bubble inside the plot at mobile sizes.
    tp.hidden=false;tp.style.left=Math.max(3,Math.min(W-tp.offsetWidth-3,hx+8))+'px';tp.style.top=Math.max(0,Math.min(H-40,cursorY-36))+'px';
    cv.setAttribute('aria-label',tp.textContent+'；左右方向键逐日查看')
  }else{$('tip').hidden=true;cv.setAttribute('aria-label','风险溢价走势图；左右方向键逐日查看')}
}
function nearest(px){
  const {x0,x1,day,start,end}=geom;const target=day(start)+(px-x0)*(day(end)-day(start))/(x1-x0);
  let lo=a,hi=b;while(lo<hi){const mid=(lo+hi)>>1;if(day(dates[mid])<target)lo=mid+1;else hi=mid}
  return lo>a&&Math.abs(day(dates[lo-1])-target)<Math.abs(day(dates[lo])-target)?lo-1:lo
}
function rescale(change,anchor){
  if(dates.length<2)return;
  const span=b-a,next=Math.min(dates.length-1,Math.max(2,Math.round(span*change)));
  let fraction=span?(anchor-a)/span:.5;
  const i=Math.round(anchor-next*fraction);setRange(i,i+next);filter=-1;render()
}
function move(e){const rect=cv.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top]}
cv.addEventListener('pointerdown',e=>{
  if(!geom.x)return;const [x,y]=move(e);if(x<geom.x0||x>geom.x1||y<geom.y0||y>geom.y1)return;
  const l=limits(focus), hit=l?.findIndex(v=>Math.abs(geom.y(v)-y)<8)??-1;
  if(hit>=0||b>a){drag={hit,x,a,b,geom};cv.setPointerCapture(e.pointerId);cv.style.cursor=hit>=0?'ns-resize':'grabbing'}
});
cv.addEventListener('pointermove',e=>{
  if(!geom.x)return;[cursorX,cursorY]=move(e);
  if(drag){const g=drag.geom;
    if(drag.hit>=0)threshold(drag.hit,g.high-(cursorY-g.y0)*(g.high-g.low)/(g.y1-g.y0));
    else{const delta=Math.round((drag.x-cursorX)*(drag.b-drag.a)/(g.x1-g.x0));filter=-1;setRange(drag.a+delta,drag.b+delta);render()}
    return;
  }
  hover=nearest(cursorX);const l=limits(focus);cv.style.cursor=l?.some(v=>Math.abs(geom.y(v)-cursorY)<8)?'ns-resize':'crosshair';draw()
});
const stop=()=>{drag=null;cv.style.cursor='crosshair'};cv.addEventListener('pointerup',stop);cv.addEventListener('pointercancel',stop);cv.addEventListener('lostpointercapture',stop);
cv.addEventListener('pointerleave',()=>{if(!drag){hover=-1;draw()}});
cv.addEventListener('wheel',e=>{if(dates.length<3||!geom.x)return;e.preventDefault();rescale(e.deltaY<0?.76:1.32,nearest(move(e)[0]))},{passive:false});
cv.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Escape'].includes(e.key))return;e.preventDefault();
  hover=e.key==='Escape'?-1:Math.max(a,Math.min(b,hover<0?b:hover+(e.key==='ArrowLeft'?-1:1)));
  cursorX=hover<0?0:geom.x(dates[hover],focus);cursorY=60;draw()
});
$('compare').onclick=()=>{compare=!compare;regroup();render()};
$('price').onclick=()=>{prices=!prices;render()};
$('presets').onclick=e=>{if(e.target.dataset.years===undefined)return;filter=Number(e.target.dataset.years);regroup();render()};
$('zoomIn').onclick=()=>rescale(.65,(a+b)/2);$('zoomOut').onclick=()=>rescale(1.54,(a+b)/2);
$('sample').onchange=e=>{sample=Number(e.target.value);render()};
$('cards').onclick=e=>{const c=e.target.closest('button')?.dataset.code;if(!c||c===focus)return;focus=c;if(!grouped[c].some(r=>r.close!=null))prices=false;if(!compare)regroup();render()};
for(const [side,i] of [['lo',0],['hi',1]]){
  $(side).oninput=e=>threshold(i,e.target.valueAsNumber);$(side+'N').onchange=e=>threshold(i,e.target.valueAsNumber)
}
$('reset').onclick=()=>{if(savedLevels[mode])delete savedLevels[mode][focus];put(storeKey+'-levels',JSON.stringify(savedLevels));render()};
function datePick(){
  const aa=$('start').value,bb=$('end').value;
  const i=dates.findIndex(d=>d>=aa),j=dates.findLastIndex(d=>d<=bb);
  if(!aa||!bb||i<0||j<0||i>=j){msg('开始日期须早于结束日期，且范围至少包含两个交易日。',true);render();return}
  msg();filter=-1;setRange(i,j);render()
}
$('start').onchange=datePick;$('end').onchange=datePick;
let ticket=0;
$('import').onchange=async e=>{
  const file=e.target.files?.[0], req=++ticket;e.target.value='';if(!file)return;
  try{
    if(file.size>6000000)throw Error('CSV 文件不超过 6 MB。');
    const source=await file.text(),next=readCSV(source);if(req!==ticket)return;
    raw=source;const stored=put(storeKey+'-source',raw);
    if(!stored)try{localStorage.removeItem(storeKey+'-source')}catch{}
    csvRows=next;setMode('csv',next);msg('已导入 '+next.length+' 行。'+(stored?'数据已保存在本浏览器。':'浏览器存储不足或不可用，仅在本页会话有效。'))
  }catch(err){if(req===ticket)msg(err.message||'无法读取 CSV。',true)}
};
$('clear').onclick=()=>{++ticket;try{localStorage.removeItem(storeKey+'-source')}catch{};raw=csvRows=null;setMode(csiRows?'csi':'wind',csiRows||SNAPSHOT);msg('已清除本地 CSV。')};
function file(name,body){
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\uFEFF',body],{type:'text/csv;charset=utf-8'}));
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
$('download').onclick=()=>file('erp-chart.csv',['date,code,pe_ttm,bond10y_pct,close,earnings_yield_pct,erp_pp,wind_source_percentile_pct,source',...plotted.map(r=>[r.date,r.code,r.pe,r.bond,r.close,r.ey,r.erp,r.sourcePct,mode].join(','))].join('\n')+'\n');
$('template').onclick=()=>file('erp-template.csv','date,code,pe_ttm,bond10y_pct,close\n');
$('source').onchange=e=>{
  ++ticket;
  const key=e.target.value,next={wind:SNAPSHOT,csi:csiRows,csv:csvRows}[key];
  if(next){setMode(key,next);msg()}
};
$('wind').href=WIND;syncPicker();regroup();render();new ResizeObserver(draw).observe($('frame'));
const initialTicket=ticket;
(async()=>{
  try{
    const res=await fetch('./data/csi.csv',{cache:'no-cache',signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw Error('HTTP '+res.status);
    const next=readCSV(await res.text());
    csiRows=next;
    if(ticket===initialTicket&&mode==='wind')setMode('csi',next);
    else syncPicker();
  }catch{
    if(ticket===initialTicket&&mode==='wind')msg('暂无可读取的中证自动数据，当前显示 Wind 原图快照。');
  }
})();
