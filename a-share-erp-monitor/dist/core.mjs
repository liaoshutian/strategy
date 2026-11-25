/* ES module; dependency free. */
export const META={
  '000852':{name:'中证1000',color:'#84efbc',levels:[-.90,.70],median:.09},
  '000905':{name:'中证500',color:'#80bfff',levels:null,median:null},
  '000300':{name:'沪深300',color:'#ffca88',levels:null,median:null}
};
export const WIND='https://finance.sina.cn/2026-11-24/detail-inizveck0157912.d.html?cre=tianyi&loc=5&mod=wfin&r=25&rfunc=21&tj=cxvertical_wap_wfin&tr=0';
export const SNAPSHOT=[
  {date:'2026-11-20',code:'000852',pe:null,ey:2.82,bond:1.58,erp:1.24,close:5648.63,sourcePct:95.6},
  {date:'2026-11-20',code:'000905',pe:null,ey:null,bond:null,erp:2.17,close:null,sourcePct:87.57},
  {date:'2026-11-20',code:'000300',pe:null,ey:null,bond:null,erp:5.84,close:null,sourcePct:72.41}
];
export const erp=(pe,bond)=>100/pe-bond;
export function spreadBands(values){
  if(!values.length)return {};
  const mean=values.reduce((a,v)=>a+v,0)/values.length;
  const sigma=Math.sqrt(values.reduce((a,v)=>a+(v-mean)**2,0)/values.length);
  return {min:Math.min(...values),max:Math.max(...values),mean,
    plus:values.length>1?mean+sigma:null,minus:values.length>1?mean-sigma:null,
    z:values.length>1&&sigma>0?(values.at(-1)-mean)/sigma:null};
}
export const pct=(sample,value)=>{
  if(sample.length<2||!Number.isFinite(value))return null;
  let less=0,equal=0; for(const x of sample){if(Math.abs(x-value)<=1e-9)equal++;else if(x<value)less++}
  return 100*(less+equal/2)/sample.length
};
export const median=(values)=>{
  if(values.length<2)return null;
  const sorted=values.slice().sort((a,b)=>a-b),m=sorted.length>>1;
  return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2
};
export function windowStart(date,yearCount){
  if(!yearCount)return '';
  const [y,m,d]=date.split('-').map(Number), end=new Date(Date.UTC(y-yearCount,m,0)).getUTCDate();
  return [y-yearCount,String(m).padStart(2,'0'),String(Math.min(d,end)).padStart(2,'0')].join('-');
}
const num=s=>/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)&&Number.isFinite(+s)?+s:null;
export function readCSV(body){
  if(body.length>6e6)throw Error('文件太大（上限 6 MB）。');
  const lines=body.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(s=>s.trim());
  const fields=s=>s.split(',').map(v=>v.trim().replace(/^"(.*)"$/,'$1'));
  const h=fields(lines.shift()||'').map(k=>k.toLowerCase()), required=['date','code','pe_ttm','bond10y_pct'];
  if(new Set(h).size!==h.length||!required.every(k=>h.includes(k)))throw Error('表头需要 date,code,pe_ttm,bond10y_pct，close 为可选。');
  if(!lines.length||lines.length>45000)throw Error('请提供 1–45,000 行数据。');
  const seen=new Set(), byDate=new Map();
  const rows=lines.map((s,i)=>{
    const fail=reason=>{throw Error('第 '+(i+2)+' 行：'+reason)};
    const v=fields(s); if(v.length!==h.length)fail('列数与表头不同。');
    const r=Object.fromEntries(h.map((k,j)=>[k,v[j]]));
    const code=r.code.replace(/\.SH$/i,'').padStart(6,'0'), date=r.date.replace(/\//g,'-');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('日期应为有效的 YYYY-MM-DD。');
    if(!Object.hasOwn(META,code))fail('代码应为 000852、000905 或 000300。');
    const pe=num(r.pe_ttm), bond=num(r.bond10y_pct),close=r.close?num(r.close):null;
    if(pe===null||pe<=0)fail('PE-TTM 应为正数；亏损或缺失行请移除。');
    if(bond===null||bond < -10||bond>25)fail('国债收益率请用百分数数值，例如 1.58，不要写 1.58%。');
    if(r.close&&(close===null||close<=0))fail('指数点位应为正数或留空。');
    const value=erp(pe,bond);
    if(!Number.isFinite(value))fail('PE-TTM 太小，结果超出数值范围。');
    const key=date+code;
    if(seen.has(key))fail('同日同指数重复。');
    if(byDate.has(date)&&Math.abs(byDate.get(date)-bond)>1e-9)fail('同日不同指数必须使用同一国债收益率。');
    seen.add(key); byDate.set(date,bond);
    return {date,code,pe,bond,close,ey:100/pe,erp:value,sourcePct:null}
  });
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code))
}
export function stats(rows,asOf,years=0){
  const from=windowStart(asOf,years);
  const eligible=rows.filter(x=>x.date>=from&&x.date<=asOf);
  const last=eligible.at(-1)||null, values=eligible.map(x=>x.erp);
  return {last,count:eligible.length,pct:last?pct(values,last.erp):null,median:median(values),from:eligible[0]?.date??null}
}
export function zone(v, levels){
  if(!levels)return '未设阈值';
  return v<levels[0]?'低于危险线':v>=levels[1]?'达到机会线':'两线之间'
}
