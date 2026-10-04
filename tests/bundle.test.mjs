import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {demo,evaluate,evaluateBundle,validate,normalizePolicy,metrics,wilson,canonical,clusterBootstrap} from '../dist/engine.js';

const HASH={data_sha256:'1'.repeat(64),recipe_sha256:'2'.repeat(64),environment_sha256:'3'.repeat(64)};
const view=(input)=>({runs:input.runs});
const viewPolicy={accuracy:.9,precision:.9,recall:.9,fpr:.1,maxSpread:.02,selectedRun:'seed-0'};
const bundle=(views,extra={})=>({contract:'2.0',name:'t',split:'test',views,...extra});
const policy=(views,extra={})=>({contract:'2.0',confidence:true,minRuns:3,views,...extra});
// Rows where y_true=1 for even indexes and errors are placed by index.
const rows=(n,errors,cluster)=>Array.from({length:n},(_,i)=>{const y=i%2;return {sample_id:'s'+i,y_true:y,y_pred:errors(i)?1-y:y,...(cluster?{cluster_id:cluster(i)}:{})};});
const runs=(n,errorsBySeed,cluster)=>[0,1,2].map(seed=>({id:'seed-'+seed,seed,rows:rows(n,errorsBySeed(seed),cluster)}));

test('v1 input normalises to a one-view bundle named default',()=>{
 const b=validate(demo('strong'));
 assert.equal(b.contract,'2.0');assert.deepEqual(Object.keys(b.views),['default']);assert.equal(b.views.default.runs.length,3);
 const v=evaluateBundle(demo('strong'),viewPolicy&&{...viewPolicy,confidence:true,minRuns:3});
 assert.deepEqual(v.requiredViews,['default']);assert.equal(v.overall,'insufficient');assert.equal(v.views.default.overall,'insufficient');
 assert.equal(evaluate(demo('strong'),{...viewPolicy,confidence:true,minRuns:3}).overall,'insufficient');
});
test('Null gates are skipped; a view with all-null gates is rejected',()=>{
 // Precision is terrible here (every negative predicted positive) but it is not gated.
 const bad=bundle({a:{runs:[0,1,2].map(seed=>({id:'seed-'+seed,seed,rows:Array.from({length:400},(_,i)=>({sample_id:'s'+i,y_true:i%2,y_pred:1}))}))}});
 const v=evaluateBundle(bad,policy({a:{accuracy:null,precision:null,recall:.9,fpr:null,maxSpread:.05,stabilityMetric:'recall'}}));
 const g=Object.fromEntries(v.views.a.gates.map(x=>[x.key,x.status]));
 assert.deepEqual(g,{accuracy:'skipped',precision:'skipped',recall:'pass',fpr:'skipped'});
 assert.equal(v.views.a.performance,'pass');
 assert.throws(()=>evaluateBundle(bad,policy({a:{accuracy:null,precision:null,recall:null,fpr:null,maxSpread:.05}})),/At least one gate/);
 assert.throws(()=>evaluateBundle(bad,policy({a:{recall:1.5,maxSpread:.05}})),/between 0 and 100/);
});
test('stabilityMetric selects the metric and fpr is judged in the downward direction',()=>{
 // Accuracy is identical across seeds; recall varies by 6 points, fpr varies by 6 points.
 const r=[0,1,2].map(seed=>({id:'seed-'+seed,seed,rows:Array.from({length:200},(_,i)=>{const y=i%2;const flipPos=y===1&&i<2*(1+3*seed);const flipNeg=y===0&&i>=200-2*(7-3*seed);return {sample_id:'s'+i,y_true:y,y_pred:flipPos||flipNeg?1-y:y};})}));
 const b=bundle({a:{runs:r}});
 const acc=evaluateBundle(b,policy({a:{accuracy:.9,maxSpread:.01,stabilityMetric:'accuracy'}})).views.a;
 assert.equal(acc.spread,0);assert.equal(acc.stability,'pass');
 const rec=evaluateBundle(b,policy({a:{recall:.9,maxSpread:.05,stabilityMetric:'recall'}})).views.a;
 assert.equal(rec.stabilityMetric,'recall');assert.ok(rec.spread>.05);assert.equal(rec.stability,'fail');
 assert.equal(evaluateBundle(b,policy({a:{recall:.9,maxSpread:.07,stabilityMetric:'recall'}})).views.a.stability,'pass');
 // fpr: each run's point value must stay at or under the target. Values are 7%, 4%, 1%.
 assert.equal(evaluateBundle(b,policy({a:{fpr:.05,maxSpread:.1,stabilityMetric:'fpr'}})).views.a.stability,'fail');
 assert.equal(evaluateBundle(b,policy({a:{fpr:.08,maxSpread:.1,stabilityMetric:'fpr'}})).views.a.stability,'pass');
 // Stability metric with a null target is insufficient, not a pass.
 assert.equal(evaluateBundle(b,policy({a:{accuracy:.9,recall:null,maxSpread:.1,stabilityMetric:'recall'}})).views.a.stability,'insufficient');
});
test('Missing policy for a required view is insufficient; policy for an unknown view is an error',()=>{
 const b=bundle({a:view(demo('strong')),b:view(demo('strong'))});
 const v=evaluateBundle(b,policy({a:viewPolicy}));
 assert.equal(v.views.b.performance,'insufficient');assert.equal(v.views.b.overall,'insufficient');assert.equal(v.views.b.policy,null);
 assert.deepEqual(v.requiredViews,['a','b']);assert.equal(v.overall,'insufficient');
 assert.throws(()=>evaluateBundle(b,policy({a:viewPolicy,zzz:viewPolicy})),/not in the bundle/);
});
test('A required:false view is reported but does not feed the overall verdict',()=>{
 const good=demo('strong');good.runs.push(structuredClone(good.runs[0]));good.runs[3].id='repeat';
 for(const r of good.runs)r.metadata={...HASH,model_sha256:'d'.repeat(64)};
 const b=bundle({good:view(good),shaky:view(demo('mixed'))});
 const v=evaluateBundle(b,policy({good:viewPolicy,shaky:{...viewPolicy,required:false}}));
 assert.equal(v.views.shaky.overall,'fail');assert.equal(v.views.good.overall,'pass');
 assert.deepEqual(v.requiredViews,['good']);assert.equal(v.overall,'pass');
 assert.equal(evaluateBundle(b,policy({good:viewPolicy,shaky:viewPolicy})).overall,'fail');
 assert.equal(evaluateBundle(b,policy({good:{...viewPolicy,required:false},shaky:{...viewPolicy,required:false}})).overall,'insufficient');
});
test('Bundle verdict is the worst required view',()=>{
 const b=bundle({a:view(demo('strong')),b:view(demo('mixed')),c:view(demo('small'))});
 assert.equal(evaluateBundle(b,policy({a:viewPolicy,b:viewPolicy,c:viewPolicy})).overall,'fail');
 assert.equal(evaluateBundle(b,policy({a:viewPolicy,c:viewPolicy})).overall,'insufficient');
});
test('Cluster bootstrap is deterministic and widens the interval when errors concentrate in a few clusters',()=>{
 // 1000 rows in 50 clusters of 20; all 60 errors sit in clusters 0–2.
 const cluster=i=>'c'+Math.floor(i/20);
 const clustered=rows(1000,i=>i<60,cluster),plain=rows(1000,i=>i<60);
 const a=metrics(clustered,{runId:'seed-0'}),b=metrics(clustered,{runId:'seed-0'}),c=metrics(clustered,{seed:7}),w=metrics(plain);
 assert.deepEqual(a,b);
 assert.equal(c.accuracy.interval_method,'cluster_bootstrap');
 assert.equal(a.accuracy.value,w.accuracy.value);assert.equal(a.accuracy.interval_method,'cluster_bootstrap');assert.equal(w.accuracy.interval_method,'wilson');assert.equal(a.clusters,50);assert.equal(w.clusters,null);
 const width=iv=>iv[1]-iv[0];
 for(const key of ['accuracy','precision','recall','fpr'])assert.ok(width(a[key].interval)>1.5*width(w[key].interval),key+' should be wider: '+width(a[key].interval)+' vs '+width(w[key].interval));
 assert.ok(a.accuracy.interval[0]<=a.accuracy.value&&a.accuracy.value<=a.accuracy.interval[1]);
 // Errors spread one per cluster give a bootstrap interval similar to Wilson, not wider by a large factor.
 const spread=metrics(rows(1000,i=>i%20===0&&i<1200,cluster),{runId:'x'});
 assert.ok(width(spread.accuracy.interval)<1.5*width(wilson(950,1000)));
 // Through the engine: a clustered run reports the method and the same intervals on repeat calls.
 const b1=bundle({a:{runs:runs(1000,()=>i=>i<60,cluster)}}),p=policy({a:{accuracy:.9,maxSpread:.05}});
 const v1=evaluateBundle(b1,p),v2=evaluateBundle(b1,p);
 assert.deepEqual(v1.views.a.gates,v2.views.a.gates);assert.equal(v1.views.a.gates[0].interval_method,'cluster_bootstrap');assert.equal(v1.views.a.confusion.clusters,50);
 assert.match(v1.views.a.notes.join(' '),/cluster-bootstrap/);assert.match(v1.notes.join(' '),/cluster-bootstrap/);
 assert.equal(clusterBootstrap(clustered,7,50).clusters,50);
});
test('cluster_id must be present on all rows of a run or none, and must be a string',()=>{
 const r=rows(20,()=>false,i=>'c'+i%4);delete r[3].cluster_id;
 assert.throws(()=>validate(bundle({a:{runs:[{id:'x',rows:r}]}})),/all rows or none/);
 const r2=rows(20,()=>false,i=>'c'+i%4);r2[0].cluster_id=4;
 assert.throws(()=>validate(bundle({a:{runs:[{id:'x',rows:r2}]}})),/nonempty string/);
});
test('Views may differ in sample ids, sizes, and seeds; mismatch within a view is rejected',()=>{
 const a=demo('strong'),b=demo('small');b.runs=b.runs.slice(0,2);b.runs.forEach((r,i)=>{r.seed=10+i;r.rows.forEach(x=>x.sample_id='other-'+x.sample_id);});
 const ok=validate(bundle({a:view(a),b:view(b)}));
 assert.equal(ok.views.a.runs[0].rows.length,1000);assert.equal(ok.views.b.runs[0].rows.length,40);
 const v=evaluateBundle(bundle({a:view(a),b:view(b)}),policy({a:viewPolicy,b:{...viewPolicy,selectedRun:'seed-0'}}));
 assert.equal(v.views.b.distinctSeeds,2);assert.equal(v.views.b.stability,'insufficient');
 const bad=demo('strong');bad.runs[1].rows[0].y_true=1-bad.runs[1].rows[0].y_true;
 assert.throws(()=>validate(bundle({a:view(a),b:view(bad)})),/View "b": Runs must use the same sample IDs/);
 const bad2=demo('strong');bad2.runs[2].rows.pop();
 assert.throws(()=>validate(bundle({a:view(bad2)})),/same sample IDs/);
});
test('Bundle metadata hashes are inherited by runs that do not set their own; model_sha256 stays per run',()=>{
 const d=demo('strong');d.runs.push(structuredClone(d.runs[0]));d.runs[3].id='repeat';
 d.runs.forEach(r=>r.metadata={model_sha256:'d'.repeat(64)});
 const b=bundle({a:view(d)},{metadata:{...HASH,notes:'synthetic'}});
 assert.equal(evaluateBundle(b,policy({a:viewPolicy})).views.a.reproducibility,'pass');
 d.runs[3].metadata.model_sha256='e'.repeat(64);
 assert.equal(evaluateBundle(b,policy({a:viewPolicy})).views.a.reproducibility,'fail');
 d.runs[3].metadata={model_sha256:'d'.repeat(64),data_sha256:'9'.repeat(64)};
 assert.equal(evaluateBundle(b,policy({a:viewPolicy})).views.a.reproducibility,'insufficient');
 assert.equal(evaluateBundle(bundle({a:view(d)}),policy({a:viewPolicy})).views.a.reproducibility,'insufficient');
});
test('Bundle structure is validated',()=>{
 assert.throws(()=>validate(bundle({},{})),/1–50 views/);
 assert.throws(()=>validate({contract:'1.5',split:'test',views:{a:view(demo('small'))}}),/contract/);
 assert.throws(()=>validate({split:'test',views:{a:view(demo('small'))}}),/contract/);
 assert.throws(()=>validate(bundle({a:{runs:[]}})),/View "a": Provide 1–50 runs/);
 assert.throws(()=>validate(bundle({a:view(demo('small'))},{split:'train'})),/split/);
 assert.throws(()=>normalizePolicy({contract:'2.0',confidence:true,minRuns:1,views:{a:viewPolicy}}),/2 to 50/);
 assert.throws(()=>normalizePolicy(policy({a:{...viewPolicy,stabilityMetric:'f1'}})),/stabilityMetric/);
 assert.throws(()=>normalizePolicy(policy({a:{...viewPolicy,required:'yes'}})),/required/);
 assert.throws(()=>evaluate(bundle({a:view(demo('small'))}),{...viewPolicy,confidence:true,minRuns:3}),/evaluateBundle/);
 const p=normalizePolicy({accuracy:.9,maxSpread:.02,minRuns:3,confidence:1});
 assert.deepEqual(p,{contract:'2.0',confidence:true,minRuns:3,views:{default:{accuracy:.9,precision:null,recall:null,fpr:null,maxSpread:.02,stabilityMetric:'accuracy',selectedRun:undefined,required:true}}});
});
test('Canonical JSON sorts keys and drops undefined so hashes do not depend on key order',()=>{
 assert.equal(canonical({b:1,a:[{d:undefined,c:null}],e:'x'}),'{"a":[{"c":null}],"b":1,"e":"x"}');
 assert.equal(canonical({a:1,b:2}),canonical({b:2,a:1}));
 const v=evaluateBundle(demo('small'),{...viewPolicy,confidence:true,minRuns:3},{input_sha256:'i'.repeat(64),policy_sha256:'p'.repeat(64)});
 assert.equal(v.input_sha256,'i'.repeat(64));assert.equal(v.policy_sha256,'p'.repeat(64));assert.equal(v.engine_version,'2.0.0');
 assert.equal(evaluateBundle(demo('small'),{...viewPolicy,confidence:true,minRuns:3}).input_sha256,null);
});

const cli=new URL('../dist/run-evidence.mjs',import.meta.url).pathname;
function run(...args){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});}
test('CLI exit codes: 0 pass, 1 fail, 2 insufficient, 3 input error',()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-evidence-'));
 const write=(name,obj)=>{const p=join(dir,name);writeFileSync(p,typeof obj==='string'?obj:JSON.stringify(obj));return p;};
 const good=demo('strong');good.runs.push(structuredClone(good.runs[0]));good.runs[3].id='repeat';for(const r of good.runs)r.metadata={...HASH,model_sha256:'d'.repeat(64)};
 const pass=write('pass.json',bundle({a:view(good)})),fail=write('fail.json',bundle({a:view(demo('mixed'))})),insuff=write('insufficient.json',demo('strong'));
 const pol=write('policy.json',policy({a:viewPolicy})),v1pol=write('policy-v1.json',{...viewPolicy,confidence:true,minRuns:3});
 const out=join(dir,'verdict.json');
 let r=run(pass,pol,'--out',out);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/OVERALL PASS/);assert.match(r.stdout,/accuracy\s+97\.5%/);
 const verdict=JSON.parse(readFileSync(out,'utf8'));assert.equal(verdict.overall,'pass');assert.equal(verdict.contract,'2.0');assert.match(verdict.input_sha256,/^[a-f0-9]{64}$/);assert.match(verdict.policy_sha256,/^[a-f0-9]{64}$/);
 r=run(fail,pol);assert.equal(r.status,1);assert.match(r.stdout,/OVERALL FAIL/);
 r=run(insuff,v1pol,'--quiet');assert.equal(r.status,2);assert.equal(r.stdout,'');
 r=run(insuff,v1pol);assert.equal(r.status,2);assert.match(r.stdout,/reproducibility insufficient/);
 r=run(join(dir,'missing.json'),pol);assert.equal(r.status,3);assert.match(r.stderr,/Cannot read/);
 r=run(write('broken.json','{not json'),pol);assert.equal(r.status,3);assert.match(r.stderr,/not valid JSON/);
 r=run(write('badsplit.json',{...demo('small'),split:'train'}),v1pol);assert.equal(r.status,3);assert.match(r.stderr,/split/);
 r=run(pass,write('badpol.json',policy({zzz:viewPolicy})));assert.equal(r.status,3);assert.match(r.stderr,/not in the bundle/);
 r=run(pass);assert.equal(r.status,3);assert.match(r.stderr,/Usage/);
 r=run(pass,pol,'--bogus');assert.equal(r.status,3);
});
test('Committed examples return the documented exit codes',()=>{
 const ex=new URL('../dist/examples/',import.meta.url).pathname;
 assert.ok(existsSync(join(ex,'bundle-v2.json')));
 let r=run(join(ex,'bundle-v2.json'),join(ex,'policy-v2.json'));assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/cluster bootstrap, 30 clusters/);assert.match(r.stdout,/required views: span, document/);
 r=run(join(ex,'predictions-v1.json'),join(ex,'policy-v1.json'));assert.equal(r.status,2,r.stdout+r.stderr);
});
