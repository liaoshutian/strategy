export const sum = xs => xs.reduce((a,b) => a+b,0);
export const ratio = (num, den) => Number.isFinite(num) && Number.isFinite(den) && den > 0 ? 100*num/den : null;
export function rolling(values,n) {
  const window=values.slice(-n);
  return window.length === n && window.every(Number.isFinite) ? sum(window) : null;
}
export function snapshot(data) {
  const {dates,holdings,flow} = data;
  const holdDates=dates.slice(-holdings.length);
  const current=holdings.at(-1);
  let peak=null,peakDate=null;
  holdings.forEach((v,i)=>{
    if (Number.isFinite(v) && (peak===null || v>peak)) {peak=v;peakDate=holdDates[i];}
  });
  const week=rolling(flow,5),month=rolling(flow,21);
  return {holdDates,current,peak,peakDate,week,month,level:ratio(current,peak),
    weekStrength:ratio(week,peak), monthStrength:ratio(month,peak)};
}

// Each day belongs to one closing-index band. Opposite signs never cancel.
export function flowProfile(rows,min,max,count=16) {
  const step=(max-min)/count;
  const bins=Array.from({length:count},(_,i)=>({
    low:min+i*step,high:i===count-1?max:min+(i+1)*step,buy:0,sell:0
  }));
  let observed=0;
  for(const [flow,,,,close] of rows){
    if(!Number.isFinite(flow)||!Number.isFinite(close)||close<min||close>max)continue;
    const bin=bins[Math.min(count-1,Math.floor((close-min)/step))];
    if(flow>0)bin.buy+=flow;
    else if(flow<0)bin.sell-=flow;
    observed++;
  }
  return {bins,observed,maxAmount:Math.max(...bins.map(b=>b.buy+b.sell))};
}
