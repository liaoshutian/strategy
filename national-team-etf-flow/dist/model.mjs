export const WINDOWS = [10,20,30,60,200];
export const sum = xs => xs.reduce((a,b) => a+b,0);
export const ratio = (num, den) => Number.isFinite(num) && Number.isFinite(den) && den > 0 ? 100*num/den : null;
export function sma(values, n) {
  let total = 0, missing = 0;
  return values.map((x,i) => {
    if (Number.isFinite(x)) total += x; else missing++;
    if (i >= n) {
      const drop=values[i-n];
      if (Number.isFinite(drop)) total -= drop; else missing--;
    }
    return i >= n-1 && missing===0 ? total/n : null;
  });
}
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
  const ma=WINDOWS.map(n=>sma(holdings,n));
  const week=rolling(flow,5),month=rolling(flow,21);
  return {holdDates,current,peak,peakDate,ma,week,month,level:ratio(current,peak),
    weekStrength:ratio(week,peak), monthStrength:ratio(month,peak),
    baselines:[...WINDOWS.map((n,i)=>['MA'+n,ma[i].at(-1)]),['历史峰值',peak]]
      .map(([name,value])=>[name,value,ratio(current,value)])};
}
