import {runExperiment} from './factory-core.js';
self.onmessage=event=>{try{const start=performance.now();const result=runExperiment(event.data,p=>self.postMessage({type:'progress',...p}));result.elapsedSeconds=(performance.now()-start)/1000;self.postMessage({type:'complete',result});}catch(e){self.postMessage({type:'error',message:e.message});}};
