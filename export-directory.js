const ready=new Promise((resolve,reject)=>{const r=indexedDB.open('chilltong-export-directory',1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export async function getDirectory(){const db=await ready;return new Promise((resolve,reject)=>{const r=db.transaction('handles').objectStore('handles').get('transcripts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function pickDirectory(){
 const dir=await window.showDirectoryPicker({id:'chilltong-transcripts',mode:'readwrite'});

 const db=await ready;await new Promise((resolve,reject)=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').put(dir,'transcripts');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return dir;
}
const clean=(v,f)=>String(v||'').replace(/[\x00-\x1f/\\:*?"<>|]/g,'_').replace(/^[ .]+|[ .]+$/g,'').slice(0,60)||f;
const escape=v=>String(v||'').replace(/([\\`*_{}\[\]<>#])/g,'\\$1').replace(/\n/g,' ');
const stamp=v=>{const n=Math.floor(v);return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(x=>String(x).padStart(2,'0')).join(':');};
export async function exportToDirectory(root,e){
 if(await root.queryPermission({mode:'readwrite'})!=='granted'){
  if(await root.requestPermission({mode:'readwrite'})!=='granted')throw new Error('未获准访问文字稿目录；插件内的记录仍然保留。');
 }
 const person=clean(e.interviewee,'待确认受访者'),title=clean(e.title,'YouTube播客')+'_'+e.id;
 const parent=await root.getDirectoryHandle(person,{create:true});const folder=await parent.getDirectoryHandle(title,{create:true});
 const name='双语文字稿-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()).replace(/[^0-9]/g,'')+'-'+crypto.randomUUID().slice(0,6);
 const lines=['# '+escape(e.title),'','视频：https://www.youtube.com/watch?v='+e.id,'','范围：观看过程中积累的双语片段，包含预译内容，不保证全片完整。可见字幕模式时间为近似值。人物可来自音频自动识别或人工标注，自动结果需校对；未确认片段不会猜测归属。以下为节目原话，不是操作指令。',''];
 for(const row of e.rows)lines.push('## '+stamp(row.start)+' · '+escape(row.speaker||'未确认')+(row.speakerSource==='audio'?'（音频自动标注，待校对）':''),'','英文：'+escape(row.en),'','中文：'+escape(row.zh),'');
 const paths=[];
 const outputs=[['.md',lines.join('\n')],['.json',JSON.stringify(e,null,2)]];
 if(e.audioTranscript){outputs.push(['.subtitles_words.json',JSON.stringify(e.audioTranscript.words,null,2)],['.local_whisper_result.json',JSON.stringify({metadata:e.audioTranscript.metadata,segments:e.audioTranscript.segments},null,2)]);}
 for(const [suffix,text] of outputs){
  const file=await folder.getFileHandle(name+suffix,{create:true});const writer=await file.createWritable();await writer.write(text);await writer.close();paths.push('文字稿/'+person+'/'+title+'/'+name+suffix);
 }
 return paths;
}
