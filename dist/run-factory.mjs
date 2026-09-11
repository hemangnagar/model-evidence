// Download factory-core.js into the same directory. No external dependencies.
// node run-factory.mjs [wear|noise|shift] [seed] [output.json]
import {writeFileSync} from 'node:fs';
import {runExperiment} from './factory-core.js';
const scenario=process.argv[2]||'wear',seed=Number(process.argv[3]||2026),output=process.argv[4]||'factory-experiment.json';
if(!Number.isInteger(seed)||seed<1||seed>999999)throw Error('Seed must be a whole number from 1 to 999999.');
const start=performance.now(),result=runExperiment({scenario,seed},p=>console.log(p));
result.elapsedSeconds=(performance.now()-start)/1000;
writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({output,elapsedSeconds:result.elapsedSeconds,trainingMachines:result.selectedMachines,testDecision:result.runs[0].decision.status,stability:result.stability,reproducible:result.reproducible},null,2));
