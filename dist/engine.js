export function wilson(k,n){
  if(!n)return null;
  const z=1.959963984540054,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
export function validate(data){
  if(!data||!Array.isArray(data.runs)||!data.runs.length||data.runs.length>50)throw Error('Provide 1–50 runs in a runs array.');
  if(!['test','validation'].includes(data.split))throw Error('split must be test or validation.');
  const names=new Set();let base;
  for(const run of data.runs){
    if(typeof run.id!=='string'||!run.id.trim()||names.has(run.id))throw Error('Each run needs a unique text id.');names.add(run.id);
    if(!Array.isArray(run.rows)||!run.rows.length)throw Error('Each run needs nonempty rows.');
    const seen=new Map();
    for(const r of run.rows){
      if(typeof r.sample_id!=='string'||!r.sample_id||seen.has(r.sample_id))throw Error('Each row needs a unique text sample_id within its run.');
      if(![0,1].includes(r.y_true)||![0,1].includes(r.y_pred))throw Error('y_true and y_pred must be numeric 0 or 1.');
      seen.set(r.sample_id,r.y_true);
    }
    if(base&&(base.size!==seen.size||[...base].some(([id,y])=>seen.get(id)!==y)))throw Error('Runs must use the same sample IDs and true labels to compare stability.');
    base=seen;
  }
  return data;
}
export function metrics(rows){
  let tp=0,tn=0,fp=0,fn=0;
  for(const r of rows){if(r.y_true===1){if(r.y_pred===1)tp++;else fn++;}else{if(r.y_pred===1)fp++;else tn++;}}
  const rate=(k,n)=>({value:n?k/n:null,interval:wilson(k,n),n,k});
  return {accuracy:rate(tp+tn,rows.length),precision:rate(tp,tp+fp),recall:rate(tp,tp+fn),fpr:rate(fp,fp+tn),tp,tn,fp,fn,n:rows.length};
}
export function gate(metric,target,direction,confidence){
  if(metric.value===null)return 'insufficient';
  const ok=direction==='min'?metric.value>=target:metric.value<=target;
  if(!ok)return 'fail';
  if(confidence&&(direction==='min'?metric.interval[0]<target:metric.interval[1]>target))return 'insufficient';
  return 'pass';
}
export function evaluate(input,policy){
  const data=validate(input);
  for(const key of ['accuracy','precision','recall','fpr','maxSpread'])if(!Number.isFinite(policy[key])||policy[key]<0||policy[key]>1)throw Error('Targets must be between 0 and 100%.');
  if(!Number.isInteger(policy.minRuns)||policy.minRuns<2||policy.minRuns>50)throw Error('Minimum distinct seeds must be an integer from 2 to 50.');
  const runs=data.runs.map(r=>({...r,metrics:metrics(r.rows)}));
  const selected=runs.find(r=>r.id===policy.selectedRun)||runs[0];
  const gates=['accuracy','precision','recall','fpr'].map(key=>({key,...selected.metrics[key],target:policy[key],direction:key==='fpr'?'max':'min',status:gate(selected.metrics[key],policy[key],key==='fpr'?'max':'min',policy.confidence)}));
  const performance=gates.some(g=>g.status==='fail')?'fail':gates.some(g=>g.status==='insufficient')?'insufficient':'pass';
  const values=runs.map(r=>r.metrics.accuracy.value),spread=Math.max(...values)-Math.min(...values),mean=values.reduce((a,b)=>a+b,0)/values.length;
  const distinctSeeds=new Set(runs.map(r=>r.seed).filter(s=>typeof s==='number'&&Number.isInteger(s))).size;
  const stability=runs.length<policy.minRuns||distinctSeeds<policy.minRuns?'insufficient':spread>policy.maxSpread||values.some(v=>v<policy.accuracy)?'fail':'pass';
  let pairs=0,agree=0;
  for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){
    const other=new Map(runs[j].rows.map(r=>[r.sample_id,r.y_pred]));
    for(const row of runs[i].rows){pairs++;if(row.y_pred===other.get(row.sample_id))agree++;}
  }
  // Only same-seed, same-recipe/environment/data artifact pairs are comparable.
  const groups=new Map();
  for(const run of runs){const m=run.metadata||{};
    if(!Number.isInteger(run.seed)||!['data_sha256','recipe_sha256','environment_sha256','model_sha256'].every(k=>typeof m[k]==='string'&&/^[a-f0-9]{64}$/i.test(m[k])))continue;
    const key=[run.seed,m.data_sha256,m.recipe_sha256,m.environment_sha256].join(':');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m.model_sha256);
  }
  const comparable=[...groups.values()].filter(g=>g.length>1);
  const reproducibility=!comparable.length?'insufficient':comparable.some(g=>new Set(g).size>1)?'fail':'pass';
  const overall=performance==='fail'||stability==='fail'||reproducibility==='fail'?'fail':performance!=='pass'||stability!=='pass'||reproducibility!=='pass'?'insufficient':'pass';
  return {version:'1.0',split:data.split,selectedRun:selected.id,policy,gates,performance,stability,reproducibility,overall,runs:runs.map(r=>({id:r.id,seed:r.seed,metrics:r.metrics})),confusion:selected.metrics,mean,spread,distinctSeeds,agreement:pairs?agree/pairs:null,comparableGroups:comparable.length,notes:['Binary classification: 1 is the positive class.','95% two-sided Wilson intervals assume independent representative observations; intervals are per metric, not simultaneous.','Data split and artifact hashes are supplied by the submitter, not independently verified.','Repeated-run stability is descriptive; it is not a guarantee about future runs.','Final-test results must not be repeatedly used to tune the model or thresholds.']};
}
export function demo(kind='mixed'){
  const n=kind==='small'?40:1000;
  return {name:kind==='small'?'Small evidence sample':kind==='strong'?'Consistent classifier':'Unstable classifier',split:'test',runs:[0,1,2].map(seed=>({id:'seed-'+seed,seed,rows:Array.from({length:n},(_,i)=>{const y=i%2;const errors=kind==='strong'?25:kind==='small'?2:[65,120,80][seed];return {sample_id:String(i),y_true:y,y_pred:i<errors?1-y:y};})}))};
}
