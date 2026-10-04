#!/usr/bin/env node
// Usage: node dist/run-evidence.mjs <bundle.json> <policy.json> [--out verdict.json] [--quiet]
// Exit codes: 0 pass, 1 fail, 2 insufficient, 3 input error.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {evaluateBundle,canonical} from './engine.js';

const EXIT={pass:0,fail:1,insufficient:2};
const LABELS={accuracy:'accuracy',precision:'precision',recall:'recall',fpr:'fpr'};
const pct=v=>v===null||v===undefined?'n/a':(v*100).toFixed(1)+'%';
const pad=(s,w)=>String(s).padEnd(w);
const sha256=text=>createHash('sha256').update(text).digest('hex');

function parseArgs(argv){
  const args={files:[],quiet:false,out:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--quiet')args.quiet=true;
    else if(a==='--out'){args.out=argv[++i];if(!args.out)throw Error('--out needs a file name.');}
    else if(a.startsWith('--'))throw Error(`Unknown option ${a}.`);
    else args.files.push(a);
  }
  if(args.files.length!==2)throw Error('Usage: node dist/run-evidence.mjs <bundle.json> <policy.json> [--out verdict.json] [--quiet]');
  return args;
}
function readJSON(path,what){
  let text;
  try{text=readFileSync(path,'utf8');}catch(e){throw Error(`Cannot read ${what} ${path}: ${e.message}`);}
  try{return JSON.parse(text);}catch(e){throw Error(`${what} ${path} is not valid JSON: ${e.message}`);}
}
export function table(verdict){
  const lines=[];
  lines.push(`${verdict.name||'Bundle'} · split ${verdict.split} · contract ${verdict.contract} · engine ${verdict.engine_version}`);
  lines.push(pad('view',16)+pad('n',8)+pad('gate',11)+pad('value',9)+pad('95% interval',19)+pad('target',10)+'result');
  for(const [name,v] of Object.entries(verdict.views)){
    const n=v.confusion.n,method=v.confusion.clusters!==null?`cluster bootstrap, ${v.confusion.clusters} clusters`:'Wilson';
    const active=v.gates.filter(g=>g.status!=='skipped');
    if(!active.length)lines.push(pad(name,16)+pad(n,8)+pad('(no policy)',11)+pad('',9)+pad('',19)+pad('',10)+'insufficient');
    active.forEach((g,i)=>{
      lines.push(pad(i?'':name,16)+pad(i?'':n,8)+pad(LABELS[g.key],11)+pad(pct(g.value),9)+pad(g.interval?`${pct(g.interval[0])} – ${pct(g.interval[1])}`:'no denominator',19)+pad(`${g.direction==='min'?'≥':'≤'} ${pct(g.target)}`,10)+g.status);
    });
    lines.push(pad('',16)+`runs ${v.runs.length} · ${method} · stability on ${v.stabilityMetric}${v.spread===null?'':` (spread ${(v.spread*100).toFixed(2)} pp)`}`);
    lines.push(pad('',16)+`performance ${v.performance} · stability ${v.stability} · reproducibility ${v.reproducibility} · overall ${v.overall.toUpperCase()}${v.policy&&!v.policy.required?' (not required)':''}`);
  }
  lines.push(`OVERALL ${verdict.overall.toUpperCase()} · required views: ${verdict.requiredViews.join(', ')||'none'}`);
  return lines.join('\n');
}
export function main(argv,io={stdout:process.stdout,stderr:process.stderr}){
  let args;
  try{args=parseArgs(argv);}catch(e){io.stderr.write(e.message+'\n');return 3;}
  let verdict;
  try{
    const input=readJSON(args.files[0],'bundle'),policy=readJSON(args.files[1],'policy');
    verdict=evaluateBundle(input,policy,{input_sha256:sha256(canonical(input)),policy_sha256:sha256(canonical(policy))});
  }catch(e){io.stderr.write('Input error: '+e.message+'\n');return 3;}
  if(args.out){try{writeFileSync(args.out,JSON.stringify(verdict,null,2)+'\n');}catch(e){io.stderr.write(`Cannot write ${args.out}: ${e.message}\n`);return 3;}}
  if(!args.quiet)io.stdout.write(table(verdict)+'\n');
  return EXIT[verdict.overall];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exit(main(process.argv.slice(2)));
