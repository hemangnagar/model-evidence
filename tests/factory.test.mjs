import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateFactory,SPLITS,DEFAULT_POLICY,runExperiment,assess,summarize,probabilities} from '../dist/factory-core.js';

test('Machine groups and outcome horizons remain separated; labels match future failures',()=>{
 const d=simulateFactory(),sets=['train','validation','test'].map(k=>new Set(d[k].map(r=>r.machine)));
 for(let i=0;i<sets.length;i++)for(let j=i+1;j<sets.length;j++)assert.equal([...sets[i]].some(m=>sets[j].has(m)),false);
 assert.ok(SPLITS.train.hours[1]+24<SPLITS.validation.hours[0]);
 assert.ok(SPLITS.validation.hours[1]+24<SPLITS.test.hours[0]);
 for(const k of ['train','validation','test'])for(const row of d[k]){
  const events=d.events.filter(f=>f.machine===row.machine&&f.hour>row.hour&&f.hour<=row.hour+24);
  assert.equal(row.y,Number(events.length>0));assert.equal(row.x.length,7);assert.ok(row.x.every(Number.isFinite));assert.ok(!('wear' in row));
 }
});
test('Future shift cannot change training or validation data',()=>{
 const a=simulateFactory('wear'),b=simulateFactory('shift');
 assert.deepEqual(a.train,b.train);assert.deepEqual(a.validation,b.validation);assert.notDeepEqual(a.test,b.test);
});
test('Never-warn baseline can have high accuracy while catching no impending failures',()=>{
 const rows=simulateFactory().test,m=summarize(rows,rows.map(()=>0));assert.ok(m.accuracy>.8);assert.equal(m.recall,0);assert.equal(m.precision,null);assert.equal(m.warnedEvents,0);assert.equal(assess(m,DEFAULT_POLICY).status,'fail');
});
test('Zero positive denominator remains insufficient rather than a perfect recall',()=>{
 const rows=Array.from({length:20},(_,machine)=>({machine,y:0,eventId:null})),m=summarize(rows,rows.map(()=>0));
 assert.equal(m.recall,null);assert.equal(assess(m,DEFAULT_POLICY).gates[0].status,'insufficient');
});
test('End-to-end learning selection, same-seed repeat, and frozen test predictions',()=>{
 const r=runExperiment();assert.equal(r.reproducible,true);assert.equal(r.runs.length,4);assert.deepEqual(r.runs[0].pred,r.runs[3].pred);
 const smallest=r.stages.find(s=>s.validationDecision.status==='pass');assert.equal(r.selectedMachines,smallest.machines);
 assert.deepEqual(probabilities(r.testRows,r.selectedModel),r.runs[0].probs);
 assert.ok(r.runs[0].summary.recall>.8);assert.ok(r.runs[0].summary.accuracy>r.baseline.accuracy);
 assert.equal(r.stages.length,4);assert.ok(r.stages.every(s=>s.trace.length<=50));
 const never={...DEFAULT_POLICY,recall:1,precision:1,fpr:0};assert.notEqual(assess(r.runs[0].summary,never).status,'pass');
});
test('Confidence policy distinguishes a measured pass from insufficient evidence',()=>{
 const m={recall:.9,precision:.85,fpr:.02,intervals:{recall:[.75,.98],precision:[.7,.94],fpr:[.005,.08]}};
 assert.equal(assess(m,{...DEFAULT_POLICY,confidence:false}).status,'pass');
 assert.equal(assess(m,{...DEFAULT_POLICY,confidence:true}).status,'insufficient');
});
