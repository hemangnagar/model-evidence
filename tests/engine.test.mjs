import test from 'node:test';
import assert from 'node:assert/strict';
import {wilson,metrics,gate,demo,evaluate,validate} from '../dist/engine.js';
const policy={accuracy:.9,precision:.9,recall:.9,fpr:.1,confidence:true,minRuns:3,maxSpread:.02};
test('Wilson handles no evidence, boundaries, and a reference interval',()=>{
 assert.equal(wilson(0,0),null);assert.ok(wilson(0,10)[0]<1e-12);assert.ok(Math.abs(wilson(90,100)[0]-.825634)<.00001);
});
test('Undefined precision cannot pass',()=>{
 const m=metrics([{y_true:0,y_pred:0}]);assert.equal(m.precision.value,null);assert.equal(gate(m.precision,0,'min',false),'insufficient');
});
test('Small sample does not establish 90% despite 95% observed accuracy',()=>{const r=evaluate(demo('small'),policy);assert.equal(r.gates[0].status,'insufficient');});
test('Good performance and stable scores do not prove reproducibility',()=>{const r=evaluate(demo('strong'),policy);assert.equal(r.performance,'pass');assert.equal(r.stability,'pass');assert.equal(r.reproducibility,'insufficient');assert.equal(r.overall,'insufficient');});
test('Unstable run fails stability',()=>{assert.equal(evaluate(demo(),policy).stability,'fail');});
test('False positive maximum uses upper interval',()=>{const m=metrics(Array.from({length:10},()=>({y_true:0,y_pred:0})));assert.equal(gate(m.fpr,.1,'max',true),'insufficient');});
test('Matching hashes pass comparable repeats; mismatch fails',()=>{
 const d=demo('strong');d.runs.push(structuredClone(d.runs[0]));d.runs[3].id='repeat';
 for(const r of d.runs)r.metadata={data_sha256:'a'.repeat(64),recipe_sha256:'b'.repeat(64),environment_sha256:'c'.repeat(64),model_sha256:'d'.repeat(64)};
 assert.equal(evaluate(d,policy).overall,'pass');d.runs[3].metadata.model_sha256='e'.repeat(64);assert.equal(evaluate(d,policy).reproducibility,'fail');
});
test('Reject mixed datasets, duplicate IDs, malformed labels, and impossible targets',()=>{
 let d=demo();d.runs[1].rows[0].y_true=1;assert.throws(()=>validate(d));
 d=demo();d.runs[1].id=d.runs[0].id;assert.throws(()=>validate(d));
 d=demo();d.runs[0].rows[0].y_pred='1';assert.throws(()=>validate(d));
 assert.throws(()=>evaluate(demo(),{...policy,accuracy:1.1}));
});
test('Prediction agreement aligns IDs even if rows are reordered',()=>{
 const d=demo('strong');d.runs[1].rows.reverse();assert.equal(evaluate(d,policy).agreement,1);
});
