import {WINDOWS,snapshot,rolling} from './model.mjs';
const $=id=>document.getElementById(id);
const money=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'});
const fmt=(v,s=false)=>Number.isFinite(v)?(s?signed:money).format(v):'—';
const pct=(v,s=false)=>v===null?'—':fmt(v,s)+'%';
const tone=v=>v>0?'pos':v<0?'neg':'';
const ink=['#225cb0','#b23d37','#a55d0a','#167265','#7e3ca3','#586774'];
const nspace='http://www.w3.org/2000/svg';

function elt(tag,txt,attrs={}){
  const el=document.createElement(tag);
  if(txt!==null) el.textContent=txt;
  for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  return el;
}
function svg(parent,tag,attrs={},text=null){
  const el=document.createElementNS(nspace,tag);
  for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  if(text!==null) el.textContent=text;
  parent.append(el);return el;
}
function row(host,cells){
  const tr=elt('tr',null);host.append(tr);
  cells.forEach((c,i)=>tr.append(Array.isArray(c)?elt(i?'td':'th',c[0],i?{class:c[1]}:{scope:'row'}):elt(i?'td':'th',c,i?{}:{scope:'row'})));
}
function card(host,label,value,caption,sty='',lead=false){
  const el=elt('article',null,{class:'card'+(lead?' lead':'')});
  el.append(elt('p',label),elt('strong',value,{class:sty}),elt('p',caption)); host.append(el);
}
function chart(host,title){
  const w=Math.max(host.clientWidth,200),h=Math.max(host.clientHeight,120);
  host.replaceChildren();
  const root=svg(host,'svg',{viewBox:[0,0,w,h].join(' '),role:'img','aria-label':title});
  return {root,w,h,left:w<400?49:65,right:w-11};
}
function line(root,x1,y1,x2,y2,attrs={}){
  return svg(root,'line',{x1,y1,x2,y2,stroke:'#d2dfe5',...attrs});
}
function axes(c,min,max,top,bottom){
  const scale=v=>bottom-(v-min)/(max-min)*(bottom-top);
  for(let i=0;i<=4;i++){
    const v=min+(max-min)*i/4,y=scale(v);
    line(c.root,c.left,y,c.right,y);
    svg(c.root,'text',{x:c.left-6,y:y+4,'text-anchor':'end'},Math.round(v).toLocaleString('zh-CN'));
  }
  return scale;
}
function datesAxis(c,dates,x,y){
  const slots=c.w<440?2:5;
  for(let i=0;i<=slots;i++){
    const ix=Math.round(i*(dates.length-1)/slots);
    svg(c.root,'text',{x:x(ix),y,'text-anchor':i===0?'start':i===slots?'end':'middle'},dates[ix]);
  }
}
function limits(values,includeZero=false){
  const finite=values.filter(Number.isFinite);
  if(includeZero) finite.push(0);
  if(!finite.length) return [0,1];
  const min=Math.min(...finite),max=Math.max(...finite),pad=(max-min)*.06||1;
  if(min===0&&max===0)return [-1,1];
  return [includeZero&&min===0?0:min-pad,includeZero&&max===0?0:max+pad];
}
function flowBars(c,values,top,bottom,x){
  const [min,max]=limits(values,true);
  const scale=axes(c,min,max,top,bottom);
  const width=Math.max(.7,Math.min(22,(c.right-c.left)/values.length*.72));
  line(c.root,c.left,scale(0),c.right,scale(0),{stroke:'#667b85'});
  values.forEach((v,i)=>{
    if(!Number.isFinite(v)||v===0)return;
    const y=scale(v), bar=svg(c.root,'rect',{x:x(i)-width/2,y:Math.min(y,scale(0)),width,height:Math.max(.8,Math.abs(y-scale(0))),fill:v>0?'#b84950':'#258566'});
    svg(bar,'title',{},fmt(v,true)+' 亿元');
  });
}
function track(c,slider,len,x,start,end,read){
  const guide=line(c.root,x(0),start,x(0),end,{stroke:'#536d79','stroke-dasharray':'4 3','pointer-events':'none'});
  slider.max=len-1;
  slider.value=len-1;
  function update(i){
    i=Math.max(0,Math.min(len-1,i));
    slider.value=i;guide.setAttribute('x1',x(i));guide.setAttribute('x2',x(i));
    slider.setAttribute('aria-valuetext',read(i));
  }
  slider.oninput=()=>update(Number(slider.value));
  function pointer(e){
    const bounds=c.root.getBoundingClientRect();
    const local=(e.clientX-bounds.left)*c.w/bounds.width;
    update(Math.round((local-x(0))/(x(len-1)-x(0)||1)*(len-1)));
  }
  c.root.addEventListener('pointermove', e=>{if(e.pointerType==='mouse')pointer(e);});
  c.root.addEventListener('pointerdown',pointer);
  update(len-1);
}
async function get(path){
  const r=await fetch(new URL(path,import.meta.url),{cache:'no-cache'});
  if(!r.ok) throw Error('HTTP '+r.status);
  return r.json();
}
function setup(market){
  const s=snapshot(market);
  $('stamp').textContent='数据日 '+market.asOf+' · '+market.funds.length+' 只 ETF · 全市场资金流代理';
  $('coverage').textContent=s.holdDates[0]+' 至 '+market.asOf+' · 最长 '+s.holdDates.length+' 个交易日 · 亿元';
  const cards=$('cards');
  card(cards,'最新交易日 · 净申赎',fmt(market.flow.at(-1),true),market.asOf+' · 亿元',tone(market.flow.at(-1)));
  card(cards,'近一周净申赎',fmt(s.week,true),'最近 5 个交易日 · 亿元',tone(s.week));
  card(cards,'近一月净申赎',fmt(s.month,true),'最近 21 个交易日 · 亿元',tone(s.month));
  for(const [name,v] of [['近半年 · 120 日',rolling(market.flow,120)],['近一年 · 242 日',rolling(market.flow,242)],['今年以来',rolling(market.flow,market.dates.filter(d=>d.slice(0,4)===market.asOf.slice(0,4)).length)]]){
    card(cards,name,fmt(v,true),'净申赎 · 亿元',tone(v));
  }
  const positions=$('position-cards');
  card(positions,'持仓水位 · 当前 / 历史峰值',pct(s.level),fmt(s.current)+' / '+fmt(s.peak)+' 亿元', '',true);
  card(positions,'近一周加仓力度 · 5 个交易日',pct(s.weekStrength,true),fmt(s.week,true)+' 亿元净申赎 / 峰值',tone(s.week),true);
  card(positions,'近一月加仓力度 · 21 个交易日',pct(s.monthStrength,true),fmt(s.month,true)+' 亿元净申赎 / 峰值',tone(s.month),true);
  s.baselines.forEach(([name,v,p])=>row($('ratios'),[name+(name==='历史峰值'?' · '+s.peakDate:''),fmt(v),pct(p)]));
  const visible=[true,true,true,true,true,true];
  const series=[market.holdings,...s.ma], labels=['持仓金额',...WINDOWS.map(n=>'MA'+n)];
  labels.forEach((label,i)=>{
    const check=elt('input',null,{type:'checkbox'});
    check.checked=true;
    const swatch=elt('span','',{class:'swatch',style:'--stroke:'+ink[i],'aria-hidden':'true'});
    const opt=elt('label',null);
    opt.append(check,swatch,label);$('legend').append(opt);
    check.addEventListener('change',()=>{visible[i]=check.checked;drawHold();});
  });
  function drawHold(){
    const c=chart($('hold-chart'),'累计持仓金额和简单均线图');
    const count=Number($('hold-range').value)||s.holdDates.length;
    const start=Math.max(0,s.holdDates.length-count),dates=s.holdDates.slice(start),end=c.h-26;
    const x=i=>c.left+i*(c.right-c.left)/Math.max(1,dates.length-1);
    const [min,max]=limits(series.flatMap((xs,i)=>visible[i]?xs.slice(start):[]));
    const y=axes(c,min,max,12,end);
    datesAxis(c,dates,x,c.h-6);
    series.forEach((xs,j)=>{
      if(!visible[j])return;
      let d='', seen=false;
      xs.slice(start).forEach((v,i)=>{
        if(!Number.isFinite(v)){seen=false;return;}
        d+=(seen?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1);seen=true;
      });
      svg(c.root,'path',{d,fill:'none',stroke:ink[j],'stroke-width':j===0?2.15:1.35,
        'stroke-dasharray':['','5 2','3 2','8 3','2 3','9 2 2 2'][j]});
    });
    track(c,$('hold-day'),dates.length,x,12,end,i=>{
      const str=dates[i]+' · '+labels.flatMap((n,j)=>visible[j]?[n+' '+fmt(series[j][start+i])]:[]).join('　');
      $('hold-read').textContent=str;return str;
    });
  }
  function drawDaily(){
    const c=chart($('daily-chart'),'近 21 个交易日净申购与净赎回');
    const dates=market.dates.slice(-21),flow=market.flow.slice(-21);
    const x=i=>c.left+(i+.5)*(c.right-c.left)/dates.length;
    flowBars(c,flow,14,c.h-25,x); datesAxis(c,dates,x,c.h-6);
  }
  const select=$('index-select');
  market.indices.forEach((name,i)=>select.append(elt('option',name,{value:i})));
  let indexRows=null, request=0;
  async function selectIndex(){
    const id=++request;
    indexRows=null;$('index-chart').replaceChildren();$('index-day').disabled=true;
    $('index-read').textContent='正在加载指数数据…';
    try {
      const name=Number(select.value);
      const rows=await get('./data/index-'+name+'.json');
      if(id!==request)return;
      if(rows.length!==market.dates.length)throw Error('date mismatch');
      indexRows=rows;$('index-day').disabled=false;drawIndex();
    }catch(e){if(id===request)$('index-read').textContent='指数数据暂不可用；持仓与资金流仍可查看。';}
  }
  function drawIndex(){
    if(!indexRows)return;
    const c=chart($('index-chart'),market.indices[Number(select.value)]+' 的日 K 线和净申赎');
    const n=Number($('index-range').value)||market.dates.length;
    const rows=indexRows.slice(-n), dates=market.dates.slice(-n),split=c.h*.64,end=c.h-25;
    const x=i=>c.left+(i+.5)*(c.right-c.left)/rows.length;
    const [min,max]=limits(rows.flatMap(r=>r.length===5?[r[2],r[3]]:[]));
    const y=axes(c,min,max,12,split-14);
    const width=Math.max(.6,Math.min(9,(c.right-c.left)/rows.length*.72));
    rows.forEach((r,i)=>{
      if(r.length!==5)return;
      const [f,o,h,l,close]=r;const fill=close>=o?'#b84950':'#258566';
      line(c.root,x(i),y(h),x(i),y(l),{stroke:fill});
      svg(c.root,'rect',{x:x(i)-width/2,y:y(Math.max(o,close)),width,height:Math.max(.8,Math.abs(y(o)-y(close))),fill});
    });
    flowBars(c,rows.map(r=>r[0]),split,end,x);
    datesAxis(c,dates,x,c.h-6);
    track(c,$('index-day'),dates.length,x,12,end,i=>{
      const [f,o,h,l,cl]=rows[i];
      const str=dates[i]+' · '+(cl===undefined?'K线缺值':'开 '+fmt(o)+'　高 '+fmt(h)+'　低 '+fmt(l)+'　收 '+fmt(cl))+'　净申赎 '+fmt(f,true)+' 亿';
      $('index-read').textContent=str;return str;
    });
  }
  const funds=market.funds.toSorted((a,b)=>(b[5]??-Infinity)-(a[5]??-Infinity));
  funds.forEach(([code,name,shares,...values])=>row($('funds'),[code+' '+name,fmt(shares),...values.slice(0,3).map(v=>[fmt(v,true),tone(v)])]));
  const head=elt('tr',null);
  ['ETF',...market.dates.slice(-10).map(d=>d.slice(5))].forEach(v=>head.append(elt('th',v,{scope:'col'})));
  $('matrix-head').append(head);
  funds.forEach(([code,name,,,,,detail])=>row($('matrix'),[code+' '+name,...detail.map(v=>[fmt(v,true),tone(v)])]));
  $('report').hidden=false;
  $('hold-range').addEventListener('change',drawHold);
  $('index-range').addEventListener('change',drawIndex);
  select.addEventListener('change',selectIndex);
  [[ $('hold-chart'),drawHold ],[ $('daily-chart'),drawDaily ],[ $('index-chart'),drawIndex ]].forEach(([host,draw])=>{
    let width=0,height=0;
    new ResizeObserver(([entry])=>{
      const {width:w,height:h}=entry.contentRect;
      if(w!==width||h!==height){width=w;height=h;draw();}
    }).observe(host);
  });
  drawHold();drawDaily();selectIndex();
}
get('./data/market.json').then(setup).catch(e=>{
  console.error(e);
  $('stamp').textContent='数据暂不可用，未显示任何未经核验的数值。请稍后刷新。';
});
