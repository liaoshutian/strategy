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
