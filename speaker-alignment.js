export function validateDiarization(input) {
  if(!input || !Array.isArray(input.turns) || input.turns.length>30000)throw new Error('说话人时间轴无效');
  const offset=Number(input.offset)||0;
  if(offset<0 || offset>172800)throw new Error('音频起点无效');
  const turns=input.turns.map(t=>{
    if(!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end<=t.start||t.end>7200||!Number.isInteger(t.speaker)||t.speaker<1||t.speaker>100)throw new Error('说话人片段无效');
    return {start:t.start+offset,end:t.end+offset,speaker:`自动说话人 ${t.speaker}`};
  }).sort((a,b)=>a.start-b.start);
  if(!turns.length)throw new Error('没有识别到有效语音，请检查音频。');
  return {turns,offset,duration:Number(input.duration)||0,engine:String(input.engine||'local audio').slice(0,200),updated:Date.now()};
}
export function assignFromAudio(row,diarization){
  // Never replace explicit human labels, including a deliberately cleared label.
  if(row.speakerSource==='manual'||(row.speaker && row.speakerSource!=='audio'))return row;
  const duration=row.end-row.start;
  if(duration<=0)return row;
  const intervals=new Map();
  for(const turn of diarization.turns){
    if(turn.start>=row.end)break;
    const start=Math.max(row.start,turn.start),end=Math.min(row.end,turn.end);
    if(end>start){if(!intervals.has(turn.speaker))intervals.set(turn.speaker,[]);intervals.get(turn.speaker).push([start,end]);}
  }
  const sums=[...intervals].map(([speaker,ranges])=>{
    let total=0,last=-Infinity;
    for(const [start,end] of ranges){total+=Math.max(0,end-Math.max(start,last));last=Math.max(last,end);}
    return {speaker,seconds:total};
  }).sort((a,b)=>b.seconds-a.seconds);
  const total=sums.reduce((n,x)=>n+x.seconds,0),best=sums[0];
  let speaker='';
  if(best && best.seconds/duration>=0.45){
    const mixed=sums.length>1 && sums[1].seconds>=Math.max(0.3,duration*0.15);
    speaker=mixed?'多人／待拆分':best.seconds/total>=0.8?best.speaker:'';
  }
  return {...row,speaker,speakerSource:'audio',speakerEvidence:sums,needsSpeakerReview:true};
}
export function alignTranscription(raw,diarization){
  if(!raw)return null;
  if(!Array.isArray(raw.words)||raw.words.length>250000||!Array.isArray(raw.segments)||raw.segments.length>30000)throw new Error('逐字稿结构无效');
  const offset=diarization.offset;
  function timed(item){
    if(!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.start<0||item.end<item.start||item.end>7200)throw new Error('逐字稿时间戳无效');
    return {start:item.start,end:item.end};
  }
  function speakerFor(item){return assignFromAudio({start:item.start+offset,end:item.end+offset,speaker:''},diarization).speaker||'';}
  const words=raw.words.map(w=>({...timed(w),text:String(w.text||'').slice(0,500),isGap:!!w.isGap,speaker:w.isGap?'':speakerFor(w)}));
  const segments=raw.segments.map(s=>({...timed(s),text:String(s.text||'').slice(0,10000),speaker:speakerFor(s),words:(s.words||[]).slice(0,2000).map(w=>({...timed(w),word:String(w.word||'').slice(0,500)}))}));
  return {metadata:{provider:'faster-whisper',model:String(raw.metadata?.model||'').slice(0,80),language:String(raw.metadata?.language||'en').slice(0,20),skill:'ai-jian-koubo',videoOffset:offset,speakerLabels:'automatic-review-required'},words,segments};
}
