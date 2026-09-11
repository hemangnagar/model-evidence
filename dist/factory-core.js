// A synthetic research experiment, not a validated model of physical machinery.
export const FEATURES=['Vibration (mm/s)','Bearing temperature (°C)','Motor current (A)','Operating load (%)','Hours since service','6-hour vibration change','6-hour temperature change'];
export const DEFAULT_POLICY={recall:.80,precision:.60,fpr:.05,confidence:true};
export const SPLITS={train:{machines:[0,59],hours:[0,215]},validation:{machines:[60,79],hours:[240,311]},test:{machines:[80,99],hours:[360,431]}};
export function random(seed){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function normal(r){return Math.sqrt(-2*Math.log(Math.max(r(),1e-9)))*Math.cos(2*Math.PI*r());}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function simulateFactory(scenario='wear',seed=2026){
 if(!['wear','noise','shift'].includes(scenario))throw Error('Unknown scenario');
 const rows=[],events=[];
 for(let machine=0;machine<100;machine++){
  const rng=random(seed+machine*7919);let wear=.05+rng()*.8,age=Math.round(wear*170),downtime=0,prior=[];
  const rate=.0028+rng()*.0018,offset=normal(rng)*.06;const history=[],failures=[];
  for(let hour=0;hour<480;hour++){
   if(downtime){downtime--;continue;}
   const shifted=scenario==='shift'&&hour>=340;
   const load=clamp(.57+.18*Math.sin(hour/13+machine)+normal(rng)*.1+(shifted?.12:0),.2,.98);
   wear+=rate*(.55+load*1.15);age++;
   const sudden=(scenario==='noise'||shifted)&&rng()<.0012;
   if(wear>=1||sudden){const event={id:`F-${machine}-${hour}`,machine,hour,cause:sudden?'Sudden fault':'Wear boundary'};failures.push(event);events.push(event);wear=.03+rng()*.06;age=0;downtime=8;prior=[];continue;}
   const noise=scenario==='noise'||shifted?2.8:1;
   const vibration=clamp(1.1+4.7*wear*wear+load*.7+offset+normal(rng)*.23*noise+(shifted?.45:0),.1,12);
   const temperature=clamp(36+load*19+wear*17+normal(rng)*1.8*noise,20,100);
   const current=clamp(7+load*12+wear*2+normal(rng)*.35*noise,2,35);
   const previous=prior.length>=6?prior[prior.length-6]:null;
   const x=[vibration,temperature,current,load*100,age,previous?vibration-previous.vibration:0,previous?temperature-previous.temperature:0];
   prior.push({vibration,temperature});
   history.push({id:`M${String(machine+1).padStart(3,'0')}-H${hour}`,machine,hour,x});
  }
  for(const row of history){if(row.hour>455)continue;const failure=failures.find(f=>f.hour>row.hour&&f.hour<=row.hour+24);row.y=failure?1:0;row.eventId=failure?.id||null;row.failureHour=failure?.hour??null;rows.push(row);}
 }
 const pick=({machines:m,hours:h})=>rows.filter(r=>r.machine>=m[0]&&r.machine<=m[1]&&r.hour>=h[0]&&r.hour<=h[1]);
 return {scenario,seed,train:pick(SPLITS.train),validation:pick(SPLITS.validation),test:pick(SPLITS.test),events};
}
export function counts(rows,predictions){let tp=0,tn=0,fp=0,fn=0;rows.forEach((r,i)=>{if(r.y){if(predictions[i])tp++;else fn++;}else{if(predictions[i])fp++;else tn++;}});return {tp,tn,fp,fn};}
function rates(c){const {tp,tn,fp,fn}=c,n=tp+tn+fp+fn;return {accuracy:n?(tp+tn)/n:null,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,fpr:fp+tn?fp/(fp+tn):null};}
const quantile=(a,p)=>{a.sort((x,y)=>x-y);return a.length?a[Math.floor((a.length-1)*p)]:null;};
export function summarize(rows,predictions,bootstrap=true){
 const c=counts(rows,predictions),m=rates(c),groups=new Map();rows.forEach((r,i)=>{if(!groups.has(r.machine))groups.set(r.machine,{rows:[],pred:[]});groups.get(r.machine).rows.push(r);groups.get(r.machine).pred.push(predictions[i]);});
 const intervals={};if(bootstrap){
  const cs=[...groups.values()].map(g=>counts(g.rows,g.pred)),samples={accuracy:[],precision:[],recall:[],fpr:[]},rng=random(551);
  for(let b=0;b<400;b++){const a={tp:0,tn:0,fp:0,fn:0};for(let j=0;j<cs.length;j++){const v=cs[Math.floor(rng()*cs.length)];for(const k of ['tp','tn','fp','fn'])a[k]+=v[k];}const r=rates(a);for(const key of Object.keys(samples))if(r[key]!==null)samples[key].push(r[key]);}
  for(const k of Object.keys(samples))intervals[k]=samples[k].length>=380?[quantile([...samples[k]],.025),quantile([...samples[k]],.975)]:null;
 }
 const events=new Set(rows.filter(r=>r.eventId).map(r=>r.eventId)),warned=new Set();rows.forEach((r,i)=>{if(r.eventId&&predictions[i])warned.add(r.eventId);});
 return {...c,...m,intervals,n:rows.length,machines:groups.size,events:events.size,warnedEvents:warned.size,missedEvents:events.size-warned.size,healthy:c.fp+c.tn,atRisk:c.tp+c.fn};
}
export function assess(m,policy){
 const gates=['recall','precision','fpr'].map(key=>{const value=m[key],interval=m.intervals[key],minimum=key!=='fpr',target=policy[key];let status=value===null?'insufficient':(minimum?value<target:value>target)?'fail':'pass';if(status==='pass'&&policy.confidence&&(!interval||(minimum?interval[0]<target:interval[1]>target)))status='insufficient';return {key,value,interval,target,minimum,status};});
 return {gates,status:gates.some(g=>g.status==='fail')?'fail':gates.some(g=>g.status==='insufficient')?'insufficient':'pass'};
}
export function standardizer(rows){const means=FEATURES.map((_,j)=>rows.reduce((a,r)=>a+r.x[j],0)/rows.length);const scales=means.map((m,j)=>Math.sqrt(rows.reduce((a,r)=>a+(r.x[j]-m)**2,0)/rows.length)||1);return {means,scales};}
function vector(row,s){return [1,...row.x.map((v,j)=>(v-s.means[j])/s.scales[j])];}
const sigmoid=z=>1/(1+Math.exp(-clamp(z,-30,30)));
export function probabilities(rows,model){return rows.map(r=>{const x=vector(r,model.scaler);return sigmoid(x.reduce((s,v,j)=>s+v*model.weights[j],0));});}
function thresholdChoice(rows,probs,policy){
 let best;
 for(let t=.05;t<=.95001;t+=.05){const m=summarize(rows,probs.map(p=>+(p>=t)),policy.confidence);
  const recall=policy.confidence?m.intervals.recall?.[0]:m.recall,precision=policy.confidence?m.intervals.precision?.[0]:m.precision,fpr=policy.confidence?m.intervals.fpr?.[1]:m.fpr;
  const violation=Math.max(0,policy.recall-(recall||0))+Math.max(0,policy.precision-(precision||0))+Math.max(0,(fpr??1)-policy.fpr)*3;
  const score=-violation*10+(m.recall||0)*.2+(m.precision||0)*.05;
  if(!best||score>best.score)best={threshold:Number(t.toFixed(3)),score,metrics:m};
 }return best;
}
export function trainModel(train,validation,seed,policy,maxEpochs=50){
 const scaler=standardizer(train),xs=train.map(r=>vector(r,scaler)),rng=random(seed),weights=Array.from({length:8},()=>normal(rng)*.025),order=train.map((_,i)=>i),trace=[];
 let bestLoss=Infinity,bestWeights,stale=0,stop='epoch_budget',selectedEpoch=0;
 for(let epoch=1;epoch<=maxEpochs;epoch++){
  for(let i=order.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  const lr=.025/(1+epoch*.04);
  for(const i of order){const x=xs[i],error=sigmoid(x.reduce((s,v,j)=>s+v*weights[j],0))-train[i].y;for(let j=0;j<weights.length;j++)weights[j]-=lr*(error*x[j]+(j?weights[j]*.0005:0));}
  const probs=probabilities(validation,{weights,scaler});const loss=-probs.reduce((s,p,i)=>s+validation[i].y*Math.log(p)+(1-validation[i].y)*Math.log(1-p),0)/validation.length;
  const choice=thresholdChoice(validation,probs,policy);
  const summary=summarize(validation,probs.map(p=>+(p>=choice.threshold)),true),decision=assess(summary,policy);
  trace.push({epoch,loss,recall:summary.recall,precision:summary.precision,fpr:summary.fpr,threshold:choice.threshold,status:decision.status});
  if(loss<bestLoss-.0001){bestLoss=loss;bestWeights=[...weights];selectedEpoch=epoch;stale=0;}else stale++;
  if(decision.status==='pass'){bestWeights=[...weights];selectedEpoch=epoch;stop='validation_target';break;}
  if(stale>=8){stop='validation_plateau';break;}
 }
 const model={weights:bestWeights,scaler},probs=probabilities(validation,model),choice=thresholdChoice(validation,probs,policy);
 model.threshold=choice.threshold;
 const validationSummary=summarize(validation,probs.map(p=>+(p>=model.threshold)));
 return {seed,model,trace,stop,selectedEpoch,validation:validationSummary,validationDecision:assess(validationSummary,policy)};
}
export function runExperiment(config={},onProgress=()=>{}){
 const {scenario='wear',seed=2026,policy=DEFAULT_POLICY}=config;
 for(const k of ['recall','precision','fpr'])if(!Number.isFinite(policy[k])||policy[k]<0||policy[k]>1)throw Error('Policy targets must be from 0 to 100%.');
 const data=simulateFactory(scenario,seed),stages=[];
 for(const machines of [4,12,30,60]){onProgress({phase:'training',machines});const train=data.train.filter(r=>r.machine<machines);const trained=trainModel(train,data.validation,11,policy);stages.push({...trained,machines,trainCount:train.length});}
 // Choose the least data that passed validation; otherwise smallest validation deficit.
 const passing=stages.find(s=>s.validationDecision.status==='pass');
 const deficit=s=>Math.max(0,policy.recall-(s.validation.recall||0))+Math.max(0,policy.precision-(s.validation.precision||0))+3*Math.max(0,(s.validation.fpr??1)-policy.fpr);
 const selected=passing||[...stages].sort((a,b)=>deficit(a)-deficit(b)||a.validation.fpr-b.validation.fpr||a.machines-b.machines)[0];
 const train=data.train.filter(r=>r.machine<selected.machines),runs=[selected];
 for(const s of [22,33,11]){onProgress({phase:s===11?'repeat':'stability',seed:s});runs.push(trainModel(train,data.validation,s,policy));}
 // Nothing above this line accesses test features or labels for training/selection.
 onProgress({phase:'test'});
 const evaluated=runs.map((run,i)=>{const probs=probabilities(data.test,run.model),pred=probs.map(p=>+(p>=run.model.threshold)),summary=summarize(data.test,pred);return {id:i===3?'seed-11-repeat':`seed-${run.seed}`,seed:run.seed,threshold:run.model.threshold,summary,decision:assess(summary,policy),probs,pred,stop:run.stop,selectedEpoch:run.selectedEpoch};});
 const baseline=summarize(data.test,data.test.map(()=>0));
 const exact=JSON.stringify(runs[0].model)===JSON.stringify(runs[3].model)&&JSON.stringify(evaluated[0].pred)===JSON.stringify(evaluated[3].pred);
 const unique=evaluated.slice(0,3),recalls=unique.map(r=>r.summary.recall),spread=Math.max(...recalls)-Math.min(...recalls);
 let agreements=0,total=0;for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(let i=0;i<data.test.length;i++){total++;if(unique[a].pred[i]===unique[b].pred[i])agreements++;}
 const stability=unique.every(r=>r.decision.status==='pass')&&spread<=.05?'pass':unique.some(r=>r.decision.status==='fail')||spread>.05?'fail':'insufficient';
 return {version:'factory-1',scenario,seed,policy,splits:SPLITS,counts:{train:data.train.length,validation:data.validation.length,test:data.test.length},stages:stages.map(({model,...rest})=>rest),selectedMachines:selected.machines,selectedTrainCount:train.length,selectionReason:passing?'Smallest training set that met the validation policy':'No training size cleared validation; best point-target deficit selected',selectedEpoch:selected.selectedEpoch,selectedModel:selected.model,runs:evaluated,baseline,reproducible:exact,stability,recallSpread:spread,agreement:agreements/total,testRows:data.test};
}
