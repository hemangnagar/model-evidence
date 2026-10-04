// model-evidence acceptance engine. Pure functions of (input, policy); no I/O.
// Contract: see CONTRACT.md. v1 inputs are normalised into a one-view v2 bundle.
export const ENGINE_VERSION='2.0.0';
export const CONTRACT_VERSION='2.0';
const GATES=['accuracy','precision','recall','fpr'];
const HASHES=['data_sha256','recipe_sha256','environment_sha256'];
const BOOTSTRAP_RESAMPLES=1000;
const BASE_NOTES=['Binary classification: 1 is the positive class.','Data split and artifact hashes are supplied by the submitter, not independently verified.','Repeated-run stability is descriptive; it is not a guarantee about future runs.','Final-test results must not be repeatedly used to tune the model or thresholds.'];
const WILSON_NOTE='95% two-sided Wilson intervals assume independent representative observations; intervals are per metric, not simultaneous.';
const CLUSTER_NOTE='95% cluster-bootstrap intervals (1000 resamples of whole clusters, percentile method, seeded by run id) assume clusters are independent; they are per metric, not simultaneous, and unreliable with very few clusters.';
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isV2=v=>isObject(v)&&(v.views!==undefined||(v.contract!==undefined&&v.contract!=='1.0'));

export function wilson(k,n){
  if(!n)return null;
  const z=1.959963984540054,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
// FNV-1a over UTF-16 code units: a stable 32-bit seed for a run id.
export function hashString(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}
// Deterministic PRNG (mulberry32).
export function random(seed){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
// Canonical JSON: sorted object keys, no whitespace. Callers hash this string.
export function canonical(value){
  if(value===undefined)return 'null';
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}

function validateView(name,view,where){
  if(!isObject(view)||!Array.isArray(view.runs)||!view.runs.length||view.runs.length>50)throw Error(where+'Provide 1–50 runs in a runs array.');
  const names=new Set();let base;
  for(const run of view.runs){
    if(!isObject(run)||typeof run.id!=='string'||!run.id.trim()||names.has(run.id))throw Error(where+'Each run needs a unique text id.');names.add(run.id);
    if(!Array.isArray(run.rows)||!run.rows.length)throw Error(where+'Each run needs nonempty rows.');
    if(run.metadata!==undefined&&!isObject(run.metadata))throw Error(where+`Run "${run.id}": metadata must be an object.`);
    const seen=new Map();let clustered=0;
    for(const r of run.rows){
      if(!isObject(r)||typeof r.sample_id!=='string'||!r.sample_id||seen.has(r.sample_id))throw Error(where+'Each row needs a unique text sample_id within its run.');
      if(![0,1].includes(r.y_true)||![0,1].includes(r.y_pred))throw Error(where+'y_true and y_pred must be numeric 0 or 1.');
      if(r.cluster_id!==undefined){if(typeof r.cluster_id!=='string'||!r.cluster_id)throw Error(where+'cluster_id must be a nonempty string.');clustered++;}
      seen.set(r.sample_id,r.y_true);
    }
    if(clustered&&clustered!==run.rows.length)throw Error(where+`Run "${run.id}": cluster_id must be present on all rows or none.`);
    if(base&&(base.size!==seen.size||[...base].some(([id,y])=>seen.get(id)!==y)))throw Error(where+'Runs must use the same sample IDs and true labels to compare stability.');
    base=seen;
  }
}
// Accepts a v1 {name, split, runs} input or a v2 bundle; returns a normalised v2 bundle.
export function validate(data){
  if(!isObject(data))throw Error('Input must be a JSON object.');
  const v2=isV2(data);
  if(v2&&data.contract!==CONTRACT_VERSION)throw Error(`A bundle with views must declare "contract": "${CONTRACT_VERSION}".`);
  if(!v2&&(!Array.isArray(data.runs)||!data.runs.length||data.runs.length>50))throw Error('Provide 1–50 runs in a runs array.');
  if(!['test','validation'].includes(data.split))throw Error('split must be test or validation.');
  if(data.metadata!==undefined&&!isObject(data.metadata))throw Error('Bundle metadata must be an object.');
  const inherited={};for(const k of HASHES)if(data.metadata&&typeof data.metadata[k]==='string')inherited[k]=data.metadata[k];
  const rawViews=v2?data.views:{default:{runs:data.runs}};
  if(!isObject(rawViews))throw Error('views must be an object keyed by view name.');
  const names=Object.keys(rawViews);
  if(!names.length||names.length>50)throw Error('Provide 1–50 views.');
  const views={};
  for(const name of names){
    if(!name.trim())throw Error('View names must be nonempty.');
    const where=v2?`View "${name}": `:'';
    validateView(name,rawViews[name],where);
    const description=rawViews[name].description;
    if(description!==undefined&&typeof description!=='string')throw Error(where+'description must be a string.');
    views[name]={description,runs:rawViews[name].runs.map(run=>({...run,metadata:{...inherited,...(run.metadata||{})}}))};
  }
  if(data.name!==undefined&&typeof data.name!=='string')throw Error('name must be a string.');
  return {contract:CONTRACT_VERSION,name:data.name,split:data.split,metadata:data.metadata||{},views};
}
function validateViewPolicy(raw,where){
  if(!isObject(raw))throw Error(where+'Each view policy must be an object.');
  const p={};
  for(const key of GATES){
    const t=raw[key];
    if(t===undefined||t===null){p[key]=null;continue;}
    if(!Number.isFinite(t)||t<0||t>1)throw Error(where+'Targets must be between 0 and 100%.');
    p[key]=t;
  }
  if(GATES.every(k=>p[k]===null))throw Error(where+'At least one gate target must be set.');
  if(!Number.isFinite(raw.maxSpread)||raw.maxSpread<0||raw.maxSpread>1)throw Error(where+'Targets must be between 0 and 100%.');
  p.maxSpread=raw.maxSpread;
  p.stabilityMetric=raw.stabilityMetric===undefined?'accuracy':raw.stabilityMetric;
  if(!GATES.includes(p.stabilityMetric))throw Error(where+'stabilityMetric must be accuracy, precision, recall, or fpr.');
  if(raw.selectedRun!==undefined&&typeof raw.selectedRun!=='string')throw Error(where+'selectedRun must be a run id.');
  p.selectedRun=raw.selectedRun;
  if(raw.required!==undefined&&typeof raw.required!=='boolean')throw Error(where+'required must be true or false.');
  p.required=raw.required!==false;
  return p;
}
// Accepts a v1 flat policy or a v2 policy bundle; returns a normalised v2 policy.
export function normalizePolicy(policy,bundle){
  if(!isObject(policy))throw Error('Policy must be a JSON object.');
  const v2=isV2(policy);
  if(v2&&policy.contract!==CONTRACT_VERSION)throw Error(`A policy with views must declare "contract": "${CONTRACT_VERSION}".`);
  if(!Number.isInteger(policy.minRuns)||policy.minRuns<2||policy.minRuns>50)throw Error('Minimum distinct seeds must be an integer from 2 to 50.');
  const rawViews=v2?policy.views:{default:policy};
  if(!isObject(rawViews))throw Error('Policy views must be an object keyed by view name.');
  const views={};
  for(const name of Object.keys(rawViews)){
    if(bundle&&!bundle.views[name])throw Error(`Policy names view "${name}" that is not in the bundle.`);
    views[name]=validateViewPolicy(rawViews[name],v2?`Policy for view "${name}": `:'');
  }
  return {contract:CONTRACT_VERSION,confidence:Boolean(policy.confidence),minRuns:policy.minRuns,views};
}

function counts(rows){let tp=0,tn=0,fp=0,fn=0;for(const r of rows){if(r.y_true===1){if(r.y_pred===1)tp++;else fn++;}else{if(r.y_pred===1)fp++;else tn++;}}return {tp,tn,fp,fn};}
const rates=c=>({accuracy:[c.tp+c.tn,c.tp+c.tn+c.fp+c.fn],precision:[c.tp,c.tp+c.fp],recall:[c.tp,c.tp+c.fn],fpr:[c.fp,c.fp+c.tn]});
function percentile(sorted,q){const i=q*(sorted.length-1),lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);}
// Whole-cluster bootstrap: resample clusters with replacement, recompute each rate, take the 2.5–97.5 percentile band.
export function clusterBootstrap(rows,seed,resamples=BOOTSTRAP_RESAMPLES){
  const byCluster=new Map();
  for(const r of rows){if(!byCluster.has(r.cluster_id))byCluster.set(r.cluster_id,[]);byCluster.get(r.cluster_id).push(r);}
  const cs=[...byCluster.values()].map(counts),rng=random(seed),samples={accuracy:[],precision:[],recall:[],fpr:[]};
  for(let b=0;b<resamples;b++){
    const a={tp:0,tn:0,fp:0,fn:0};
    for(let j=0;j<cs.length;j++){const v=cs[Math.floor(rng()*cs.length)];a.tp+=v.tp;a.tn+=v.tn;a.fp+=v.fp;a.fn+=v.fn;}
    const r=rates(a);for(const key of GATES){const [k,n]=r[key];if(n)samples[key].push(k/n);}
  }
  const intervals={};
  for(const key of GATES){const s=samples[key].sort((x,y)=>x-y);intervals[key]=s.length<2?null:[percentile(s,.025),percentile(s,.975)];}
  return {intervals,clusters:cs.length};
}
// Point estimates are always exact counts; only the interval method varies.
export function metrics(rows,options={}){
  const c=counts(rows),r=rates(c),clustered=rows.length>0&&rows[0].cluster_id!==undefined;
  const boot=clustered?clusterBootstrap(rows,options.seed===undefined?hashString(String(options.runId||'')):options.seed):null;
  const out={};
  for(const key of GATES){const [k,n]=r[key];out[key]={value:n?k/n:null,interval:clustered?(n?boot.intervals[key]:null):wilson(k,n),n,k,interval_method:clustered?'cluster_bootstrap':'wilson'};}
  return {...out,tp:c.tp,tn:c.tn,fp:c.fp,fn:c.fn,n:rows.length,clusters:clustered?boot.clusters:null};
}
export function gate(metric,target,direction,confidence){
  if(metric.value===null)return 'insufficient';
  const ok=direction==='min'?metric.value>=target:metric.value<=target;
  if(!ok)return 'fail';
  if(confidence&&(direction==='min'?metric.interval[0]<target:metric.interval[1]>target))return 'insufficient';
  return 'pass';
}
const worst=list=>list.some(s=>s==='fail')?'fail':list.some(s=>s==='insufficient')?'insufficient':'pass';
// Judge one view. `vp` is a normalised view policy, or null when the bundle policy has no entry for the view.
function evaluateView(split,view,vp,shared){
  const runs=view.runs.map(r=>({...r,metrics:metrics(r.rows,{runId:r.id})}));
  const selected=(vp&&runs.find(r=>r.id===vp.selectedRun))||runs[0];
  const gates=GATES.map(key=>{const target=vp?vp[key]:null,direction=key==='fpr'?'max':'min';
    return {key,...selected.metrics[key],target,direction,status:target===null?'skipped':gate(selected.metrics[key],target,direction,shared.confidence)};});
  const active=gates.filter(g=>g.status!=='skipped');
  const performance=active.length?worst(active.map(g=>g.status)):'insufficient';
  const stabilityMetric=vp?vp.stabilityMetric:'accuracy',target=vp?vp[stabilityMetric]:null;
  const values=runs.map(r=>r.metrics[stabilityMetric].value),defined=values.every(v=>v!==null);
  const spread=defined?Math.max(...values)-Math.min(...values):null,mean=defined?values.reduce((a,b)=>a+b,0)/values.length:null;
  const distinctSeeds=new Set(runs.map(r=>r.seed).filter(s=>typeof s==='number'&&Number.isInteger(s))).size;
  const misses=v=>stabilityMetric==='fpr'?v>target:v<target;
  const stability=runs.length<shared.minRuns||distinctSeeds<shared.minRuns||target===null||!defined?'insufficient':spread>vp.maxSpread||values.some(misses)?'fail':'pass';
  let pairs=0,agree=0;
  for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){
    const other=new Map(runs[j].rows.map(r=>[r.sample_id,r.y_pred]));
    for(const row of runs[i].rows){pairs++;if(row.y_pred===other.get(row.sample_id))agree++;}
  }
  // Only same-seed, same-recipe/environment/data artifact pairs are comparable.
  const groups=new Map();
  for(const run of runs){const m=run.metadata||{};
    if(!Number.isInteger(run.seed)||![...HASHES,'model_sha256'].every(k=>typeof m[k]==='string'&&/^[a-f0-9]{64}$/i.test(m[k])))continue;
    const key=[run.seed,m.data_sha256,m.recipe_sha256,m.environment_sha256].join(':');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m.model_sha256);
  }
  const comparable=[...groups.values()].filter(g=>g.length>1);
  const reproducibility=!comparable.length?'insufficient':comparable.some(g=>new Set(g).size>1)?'fail':'pass';
  const overall=worst([performance,stability,reproducibility]);
  const clustered=runs.some(r=>r.metrics.clusters!==null);
  const notes=[BASE_NOTES[0],clustered?CLUSTER_NOTE:WILSON_NOTE,...BASE_NOTES.slice(1)];
  if(!vp)notes.push('No policy entry for this view: no gates were evaluated, so the view is insufficient evidence.');
  return {version:'1.0',split,description:view.description,selectedRun:selected.id,policy:vp?{...vp,confidence:shared.confidence,minRuns:shared.minRuns}:null,gates,performance,stability,stabilityMetric,reproducibility,overall,runs:runs.map(r=>({id:r.id,seed:r.seed,metrics:r.metrics})),confusion:selected.metrics,mean,spread,distinctSeeds,agreement:pairs?agree/pairs:null,comparableGroups:comparable.length,notes};
}
// New entry point. `hashes` = {input_sha256, policy_sha256} computed by the caller over canonical(input) / canonical(policy).
export function evaluateBundle(input,policy,hashes={}){
  const bundle=validate(input),pol=normalizePolicy(policy,bundle),shared={confidence:pol.confidence,minRuns:pol.minRuns};
  const views={},requiredViews=[];
  for(const name of Object.keys(bundle.views)){
    const vp=pol.views[name]||null;
    views[name]=evaluateView(bundle.split,bundle.views[name],vp,shared);
    if(!vp||vp.required)requiredViews.push(name);
  }
  const overall=requiredViews.length?worst(requiredViews.map(n=>views[n].overall)):'insufficient';
  const clustered=Object.values(views).some(v=>v.runs.some(r=>r.metrics.clusters!==null));
  const notes=[BASE_NOTES[0],WILSON_NOTE,...BASE_NOTES.slice(1),'Views are judged independently; the bundle verdict is the worst required view.'];
  if(clustered)notes.push(CLUSTER_NOTE);
  if(!requiredViews.length)notes.push('No view is required, so the bundle cannot pass.');
  return {contract:CONTRACT_VERSION,engine_version:ENGINE_VERSION,name:bundle.name,split:bundle.split,overall,views,requiredViews,policy:pol,policy_sha256:hashes.policy_sha256??null,input_sha256:hashes.input_sha256??null,notes};
}
// v1 entry point: judges a {name, split, runs} input with a flat policy and returns the single view's result.
export function evaluate(input,policy){
  if(isV2(input)||isV2(policy))throw Error('evaluate() takes a v1 input and flat policy; use evaluateBundle() for bundles with views.');
  return {...evaluateBundle(input,policy).views.default,policy};
}
export function demo(kind='mixed'){
  const n=kind==='small'?40:1000;
  return {name:kind==='small'?'Small evidence sample':kind==='strong'?'Consistent classifier':'Unstable classifier',split:'test',runs:[0,1,2].map(seed=>({id:'seed-'+seed,seed,rows:Array.from({length:n},(_,i)=>{const y=i%2;const errors=kind==='strong'?25:kind==='small'?2:[65,120,80][seed];return {sample_id:String(i),y_true:y,y_pred:i<errors?1-y:y};})}))};
}
