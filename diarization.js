export function identifySpeakers(file,speakers,onProgress,transcribe=false){
  if(!file || file.size>160*1024*1024)throw new Error('请选择不超过 160 MB 的原始音频。');
  const port=chrome.runtime.connectNative('com.chilltong.diarization');
  let finished=false,pending,resolveResult,rejectResult;const turns=[],words=[],segments=[];
  const result=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
  function fail(message){if(finished)return;finished=true;const e=new Error(message);pending?.reject(e);rejectResult(e);port.disconnect();}
  port.onDisconnect.addListener(()=>{if(!finished)fail(chrome.runtime.lastError?.message || '识别助手已断开。');});
  port.onMessage.addListener(message=>{
    if(message.type==='error')return fail(message.error);
    if(message.type==='words'){words.push(...message.items);if(words.length>250000)fail('逐字转录数量超限');}
    if(message.type==='segments'){segments.push(...message.items);if(segments.length>30000)fail('转录片段数量超限');}
    if(message.type==='turns'){turns.push(...message.turns);if(turns.length>30000)fail('说话人片段数量超限');}
    if(message.type==='progress')onProgress(message);
    if(message.type==='ready'||message.type==='ack'){pending?.resolve(message);pending=null;}
    if(message.type==='result'){finished=true;resolveResult({...message,turns:message.turns||turns,transcription:message.transcriptionMetadata?{metadata:message.transcriptionMetadata,words,segments}:null});port.disconnect();}
  });
  function request(message){return new Promise((resolve,reject)=>{pending={resolve,reject};port.postMessage(message);});}
  (async()=>{
    await request({action:'start',size:file.size,speakers,transcribe});
    let seq=0;
    for(let offset=0;offset<file.size;offset+=384*1024){
      const bytes=new Uint8Array(await file.slice(offset,offset+384*1024).arrayBuffer());
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      await request({action:'chunk',seq:seq++,data:btoa(binary)});
      onProgress({stage:'正在读取本地音频',percent:Math.round((offset+bytes.length)/file.size*100)});
    }
    port.postMessage({action:'finish'});
  })().catch(e=>fail(e.message));
  return {result,cancel:()=>fail('已取消识别；原文字稿与人物标注未改动。')};
}
