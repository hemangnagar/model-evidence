import {demo,validate,evaluateBundle,canonical} from './engine.js';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v===null||v===undefined?'Undefined':(v*100).toFixed(1)+'%';
const GATES=['accuracy','precision','recall','fpr'];
const labels={accuracy:'Accuracy',precision:'Precision',recall:'Recall',fpr:'False-positive rate'},status={pass:'Pass',fail:'Fail',insufficient:'Insufficient evidence',skipped:'Not evaluated'};
// raw: the imported JSON as supplied (hashed as-is). bundle: its normalised v2 form. policy: a v2 policy edited through the form, one entry per view.
let raw,bundle,policy={contract:'2.0',confidence:true,minRuns:3,views:{}},current,report;
function download(name,object){const url=URL.createObjectURL(new Blob([JSON.stringify(object,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function sha256(text){if(!globalThis.crypto?.subtle)return null;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
// Form → policy for the selected view. Blank gate fields mean the gate is not evaluated.
function readForm(){
  const vp={selectedRun:$('run').value,stabilityMetric:$('stabilityMetric').value,required:$('required').checked};
  for(const k of GATES)vp[k]=$(k).value===''?null:Number($(k).value)/100;
  if(GATES.every(k=>vp[k]===null))throw Error('Set at least one gate target; blank fields are not evaluated.');
  if($('maxSpread').value==='')throw Error('Fill in the maximum spread.');
  vp.maxSpread=Number($('maxSpread').value)/100;
  policy.confidence=$('confidence').checked;policy.minRuns=Number($('minRuns').value);
  if(!Number.isInteger(policy.minRuns)||policy.minRuns<2||policy.minRuns>50)throw Error('Minimum seeds must be an integer from 2 to 50.');
  policy.views[current]=vp;
}
function fillForm(name){
  const vp=policy.views[name];
  $('run').innerHTML=bundle.views[name].runs.map(r=>`<option value="${esc(r.id)}">${esc(r.id)}</option>`).join('');
  $('run').value=vp.selectedRun;if(!$('run').value)$('run').selectedIndex=0;
  for(const k of GATES)$(k).value=vp[k]===null?'':+(vp[k]*100).toFixed(4);
  $('maxSpread').value=+(vp.maxSpread*100).toFixed(4);$('stabilityMetric').value=vp.stabilityMetric;$('required').checked=vp.required;
  $('confidence').checked=policy.confidence;$('minRuns').value=policy.minRuns;
}
async function assess(){
  try{
    readForm();
    const [input_sha256,policy_sha256]=await Promise.all([sha256(canonical(raw)),sha256(canonical(policy))]);
    report=evaluateBundle(raw,policy,{input_sha256,policy_sha256});
    $('error').textContent='';$('export').disabled=false;render();
  }catch(e){$('error').textContent=e.message;$('export').disabled=true;}
}
// Accept a v1 {name, split, runs} file or a v2 bundle. Every view starts from the targets currently in the form.
function load(next){
  const normalised=validate(next);
  raw=next;bundle=normalised;
  const defaults={};for(const k of GATES)defaults[k]=$(k).value===''?null:Number($(k).value)/100;
  if(GATES.every(k=>defaults[k]===null))defaults.accuracy=.9;
  policy.views={};
  for(const name of Object.keys(bundle.views))policy.views[name]={...defaults,maxSpread:$('maxSpread').value===''?.02:Number($('maxSpread').value)/100,stabilityMetric:$('stabilityMetric').value,selectedRun:bundle.views[name].runs[0].id,required:true};
  current=Object.keys(bundle.views)[0];
  const names=Object.keys(bundle.views),v2=!(names.length===1&&names[0]==='default');
  $('bundlebar').hidden=!v2;
  $('view').innerHTML=names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');$('view').value=current;
  const samples=names.reduce((a,n)=>a+bundle.views[n].runs[0].rows.length,0),runCount=names.reduce((a,n)=>a+bundle.views[n].runs.length,0);
  $('dataset').textContent=`${bundle.name||'Imported predictions'} · ${v2?names.length+' views · ':''}${samples.toLocaleString()} samples · ${runCount} runs`;
  fillForm(current);assess();
}
function switchView(name){try{readForm();}catch(e){$('error').textContent=e.message;}current=name;fillForm(name);assess();}
function render(){const r=report.views[current],cm=r.confusion,vp=r.policy,metric=r.stabilityMetric;
  $('bundle').innerHTML=`Bundle verdict: <span class="pill ${report.overall}">${status[report.overall]}</span> · ${Object.keys(report.views).length} views · required: ${report.requiredViews.map(esc).join(', ')||'none'}${report.input_sha256?' · input sha256 '+report.input_sha256.slice(0,12)+'…':''}`;
  $('banner').className='banner '+r.overall;
  const viewTitle=$('bundlebar').hidden?'':` · view “${esc(current)}”`;
  const title=r.overall==='fail'?'Requirements not met':r.overall==='pass'?'All configured checks passed':'More evidence is needed';
  $('banner').innerHTML=`<h2>${title}${r.split==='validation'?' · provisional':''}${viewTitle}</h2><p>${r.performance==='fail'?'The selected model misses one or more performance targets.':r.performance==='insufficient'?'The point scores are not enough to establish the required performance.':'The selected model clears its performance gates.'} ${r.stability==='fail'?'Repeated training is outside your stability limits.':''} ${r.reproducibility==='insufficient'?'Exact reproducibility has not been established.':''}${vp&&!vp.required?' This view is reported only and does not feed the bundle verdict.':''}</p>`;
  $('cards').innerHTML=[['Classification',status[r.performance],pct(cm.accuracy.value)+' measured accuracy'],['Training stability',status[r.stability],r.spread===null?'Spread undefined':(r.spread*100).toFixed(1)+' percentage-point '+labels[metric].toLowerCase()+' spread'],['Reproducibility',r.reproducibility==='insufficient'?'Not established':status[r.reproducibility],r.comparableGroups+' comparable artifact groups']].map(([name,value,note])=>`<div class="card"><p>${name}</p><strong>${value}</strong><small>${note}</small></div>`).join('');
  $('split').textContent=r.split.toUpperCase()+' SET';
  $('gates').innerHTML=r.gates.map(g=>`<tr><td>${labels[g.key]}</td><td>${pct(g.value)}</td><td>${g.interval?g.interval.map(pct).join(' – '):'No denominator'}</td><td>${g.target===null?'—':(g.direction==='min'?'≥ ':'≤ ')+pct(g.target)}</td><td><span class="pill ${g.status}">${status[g.status]}</span></td></tr>`).join('');
  $('interval-note').textContent=cm.clusters!==null?`Intervals are 95% cluster-bootstrap percentile bands over ${cm.clusters.toLocaleString()} clusters (1,000 resamples, seeded by run id). They assume independent clusters and are per metric, not simultaneous.`:'Intervals are 95% Wilson intervals, per metric, and assume independent, representative samples. Add cluster_id to rows to use a cluster bootstrap for correlated data.';
  const target=vp?vp[metric]:null;
  $('bars-title').textContent=labels[metric]+' by run';
  $('bars').innerHTML=r.runs.map(run=>{const v=run.metrics[metric].value;return `<div class="run"><div class="runhead"><span>${esc(run.id)}${run.id===r.selectedRun?' · selected':''}</span><strong>${pct(v)}</strong></div><div class="bar"><span style="width:${(v||0)*100}%"></span>${target===null?'':`<i style="left:${target*100}%" title="${labels[metric]} target"></i>`}</div></div>`;}).join('');
  $('agreement').textContent=`Mean ${labels[metric].toLowerCase()} ${pct(r.mean)} · Pairwise prediction agreement ${pct(r.agreement)} · ${r.distinctSeeds} distinct recorded seeds.${target===null?' No target is set for the stability metric, so stability is insufficient evidence.':' Red marker = target.'}`;
  $('matrix').innerHTML=[['True positives',cm.tp,false],['False negatives',cm.fn,true],['False positives',cm.fp,true],['True negatives',cm.tn,false]].map(([name,n,bad])=>`<div class="cell ${bad?'error':''}"><strong>${n.toLocaleString()}</strong><span>${name}</span></div>`).join('');
  $('repro-title').textContent=r.reproducibility==='insufficient'?'Similar scores do not prove identical training':r.reproducibility==='fail'?'Same recorded setup, different model artifacts':'Comparable model artifact hashes match';
  $('repro-copy').textContent=r.reproducibility==='insufficient'?'These results can measure stability. To check exact reproducibility, include repeated runs with the same seed and matching data, recipe, and environment fingerprints, plus their model artifact fingerprints.':r.reproducibility==='fail'?'At least one comparable group has different model hashes. Check the training environment, deterministic operations, and artifact serialization.':'The supplied hashes match within every comparable group. This supports artifact reproducibility for those recorded setups; it does not prove reproducibility on other hardware or verify the submitted hashes.';
}
$('assess').onclick=assess;$('run').onchange=assess;$('view').onchange=()=>switchView($('view').value);
for(const id of [...GATES,'maxSpread','minRuns','confidence','stabilityMetric','required'])$(id).onchange=assess;
$('example').insertAdjacentHTML('beforeend','<option value="trained">Actual training on synthetic data</option><option value="bundle">Two-view bundle (contract 2.0)</option>');
$('example').onchange=async()=>{try{const v=$('example').value;if(v==='trained'||v==='bundle'){const response=await fetch(v==='trained'?'/trained-example.json':'/examples/bundle-v2.json');if(!response.ok)throw Error('Example could not be loaded.');load(await response.json());}else load(demo(v));}catch(e){$('error').textContent=e.message;}};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('Please use a JSON file smaller than 10 MB.');load(JSON.parse(await file.text()));}catch(e){$('error').textContent='Import failed: '+e.message;}};
$('sample').onclick=()=>download('classification-predictions.json',demo('strong'));
$('export').onclick=async()=>{await assess();if(!$('export').disabled)download('classification-assessment.json',report);};
load(demo());
