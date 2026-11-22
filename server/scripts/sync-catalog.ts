import { syncCatalog, syncState } from '../src/scryfall/sync.js';
const t=Date.now();
const iv=setInterval(()=>console.log(syncState.phase, syncState.processed),15000);
await syncCatalog();
clearInterval(iv);
console.log('final', syncState, (Date.now()-t)/1000+'s');
