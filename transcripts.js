import {snapshotEpisode,renderPublication} from './blog-publication.js';
import {validateDiarization,assignFromAudio,alignTranscription} from './speaker-alignment.js';
const dbReady = new Promise((resolve,reject) => {
  const request=indexedDB.open('chilltong-transcripts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('episodes',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
});
let queue=Promise.resolve();
function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
async function read(id){const db=await dbReady;return new Promise((resolve,reject)=>{const q=db.transaction('episodes').objectStore('episodes').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function write(value){const db=await dbReady;return new Promise((resolve,reject)=>{const tx=db.transaction('episodes','readwrite');tx.objectStore('episodes').put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);});}
export const episode = id => serial(()=>read(id));
export async function listEpisodes(){await queue;const db=await dbReady;return new Promise((resolve,reject)=>{const q=db.transaction('episodes').objectStore('episodes').getAll();q.onsuccess=()=>resolve(q.result.map(e=>({id:e.id,title:e.title,updated:e.updated,created:e.created,count:e.rows.length})).sort((a,b)=>b.updated-a.updated));q.onerror=()=>reject(q.error);});}
export function record(id,title,rows){return serial(async()=>{
  let data=await read(id)||{id,title,interviewee:'',speakers:['说话人 1','说话人 2','多人／待拆分'],rows:[],created:Date.now()};
  if(title) data.title=title.slice(0,250);
  const lookup=new Map(data.rows.map(r=>[r.key,r]));
  for(const r of rows){
    if(!Number.isFinite(r.start)||r.start<0||r.start>172800||typeof r.en!=='string'||!r.en.trim()) continue;
    const key=String(r.key||`${r.start.toFixed(3)}:${r.en}`).slice(0,2100);
    const old=lookup.get(key);
    const row={key,start:r.start,end:Math.max(r.start,Math.min(172800,Number(r.end)||r.start)),en:r.en.slice(0,1800),zh:typeof r.zh==='string'?r.zh.slice(0,3000):'',source:r.source==='timeline'?'timeline':'visible',speaker:old?.speaker||'',turnHint:r.en.includes('>>')};
    if(old) Object.assign(old,row); else {data.rows.push(row);lookup.set(key,row);}
    if(data.diarization){const target=old||row;Object.assign(target,assignFromAudio(target,data.diarization));}
  }
  data.rows.sort((a,b)=>a.start-b.start);data.updated=Date.now();await write(data);return {count:data.rows.length};
});}
export function editEpisode(id,patch){return serial(async()=>{
  const data=await read(id);if(!data)throw new Error('文字稿不存在');
  if(typeof patch.interviewee==='string')data.interviewee=patch.interviewee.trim().slice(0,80);
  if(Array.isArray(patch.speakers))data.speakers=[...new Set(patch.speakers.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,80)).filter(Boolean))].slice(0,30);
  if(Array.isArray(patch.assignments))for(const a of patch.assignments){const row=data.rows.find(r=>r.key===a.key);if(row && (a.speaker===''||data.speakers.includes(a.speaker))){row.speaker=a.speaker;row.speakerSource='manual';row.needsSpeakerReview=false;}}
  delete data.blogDraft;if(data.publication)data.publication.reviewed=false;
  data.updated=Date.now();return write(data);
});}

export function applyDiarization(id,result){return serial(async()=>{
  const data=await read(id);if(!data)throw new Error('文字稿不存在');
  delete data.blogDraft;if(data.publication)data.publication.reviewed=false;
  for(const [label,identity] of Object.entries(data.identities||{}))if(label.startsWith('自动说话人 '))identity.confirmed=false;
  data.diarization=validateDiarization(result);
  data.rows=data.rows.map(row=>assignFromAudio(row,data.diarization));
  if(result.transcription)data.audioTranscript=alignTranscription(result.transcription,data.diarization);
  data.speakers=[...new Set([...data.speakers,...data.diarization.turns.map(t=>t.speaker),'多人／待拆分'])];
  data.updated=Date.now();return write(data);
});}

export function saveReview(id,patch){return serial(async()=>{
  const data=await read(id);if(!data)throw new Error('文字稿不存在');
  data.identities ||= {};
  if(Array.isArray(patch.identities))for(const item of patch.identities){
    if(!data.speakers.includes(item.label))throw new Error('人物编号不存在');
    const name=String(item.name||'').trim().slice(0,80),role=String(item.role||'').trim().slice(0,80);
    data.identities[item.label]={name,role,confirmed:!!item.confirmed && !!name};
  }
  if(Array.isArray(patch.rows))for(const change of patch.rows){
    const row=data.rows.find(r=>r.key===change.key);if(!row)continue;
    if(typeof change.en==='string')row.editedEn=change.en.slice(0,10000);
    if(typeof change.zh==='string')row.editedZh=change.zh.slice(0,10000);
    if(typeof change.excluded==='boolean')row.excluded=change.excluded;
    if(typeof change.speaker==='string' && change.speaker!==row.speaker && (change.speaker===''||data.speakers.includes(change.speaker))){row.speaker=change.speaker;row.speakerSource='manual';row.needsSpeakerReview=false;}
  }
  if(patch.split){
    const {key,time,parts}=patch.split,index=data.rows.findIndex(r=>r.key===key),row=data.rows[index];
    if(!row||!Number.isFinite(time)||time<=row.start||time>=row.end||!Array.isArray(parts)||parts.length!==2||parts.some(p=>!p.en?.trim()||!p.zh?.trim()||!data.speakers.includes(p.speaker)))throw new Error('拆分需要有效时间、两段中英文及人物');
    (data.rowHistory ||= []).push({row,reason:'split',at:Date.now()});
    const added=parts.map((part,i)=>({...row,key:'split:'+crypto.randomUUID(),start:i?time:row.start,end:i?row.end:time,en:part.en.trim().slice(0,10000),zh:part.zh.trim().slice(0,10000),editedEn:part.en.trim().slice(0,10000),editedZh:part.zh.trim().slice(0,10000),speaker:part.speaker,speakerSource:'manual',needsSpeakerReview:false}));
    data.rows.splice(index,1,...added);
  }
  data.publication={...data.publication,reviewed:false};
  if(patch.publication){for(const field of ['title','description','introduction','category'])if(typeof patch.publication[field]==='string')data.publication[field]=patch.publication[field].slice(0,field==='introduction'?20000:300);data.publication.reviewed=patch.publication.reviewed===true;}
  delete data.blogDraft;data.updated=Date.now();return write(data);
});}
export function prepareBlog(id){return serial(async()=>{
  const data=await read(id);if(!data)throw new Error('文字稿不存在');
  const prepared=await renderPublication(snapshotEpisode(data));
  data.blogDraft={snapshot:prepared.snapshot,hash:prepared.hash};await write(data);return prepared;
});}
export function savePublished(id,result){return serial(async()=>{const data=await read(id);if(!data)throw new Error('文字稿不存在');data.published=result;return write(data);});}
