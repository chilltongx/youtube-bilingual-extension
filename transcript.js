import {identifySpeakers} from './diarization.js';
import {getDirectory,pickDirectory,exportToDirectory} from './export-directory.js';
const $=id=>document.getElementById(id);
let data, episodes=[], limit=100, recognition, sharedAudioURL;
const selected=new Set();
async function send(message){const r=await chrome.runtime.sendMessage(message);if(!r.ok)throw new Error(r.error||'操作失败');return r;}
function status(text){$('status').textContent=text;}
function time(value){const n=Math.floor(value);return `${Math.floor(n/3600).toString().padStart(2,'0')}:${Math.floor(n/60)%60<10?'0':''}${Math.floor(n/60)%60}:${String(n%60).padStart(2,'0')}`;}
function choices(element,values,value){element.replaceChildren();for(const [id,label] of values){const o=document.createElement('option');o.value=id;o.textContent=label;element.append(o);}if(value!==undefined)element.value=value;}
async function loadList(){
  const id=$('episodes').value||new URL(location.href).searchParams.get('v');
  episodes=(await send({type:'list-transcripts'})).episodes;
  choices($('episodes'),episodes.map(e=>[e.id,`${e.title||e.id} · ${e.count} 段`]),episodes.some(e=>e.id===id)?id:episodes[0]?.id);
  if(!episodes.length){$('editor').hidden=true;status('还没有积累的文字稿。打开 YouTube 英文字幕和翻译后，会从现在开始自动保存；之前未记录的内容无法追溯。');return;}
  await load();
}
async function load(){
  data=(await send({type:'read-transcript',id:$('episodes').value})).episode;
  selected.clear();limit=100;$('editor').hidden=!data;if(!data)return;
  history.replaceState(null,'','?v='+encodeURIComponent(data.id));
  $('title').textContent=data.title||data.id;$('interviewee').value=data.interviewee||'';
  $('speakers').value=data.speakers.join('\n');
  choices($('filter'),[['all','全部人物'],['','未确认'],...data.speakers.map(s=>[s,s])],'all');
  choices($('assign'),[['','未确认'],...data.speakers.map(s=>[s,s])]);
  $('coverage').textContent=`已积累 ${data.rows.length} 段 · 含提前翻译的片段，不代表完整节目或全部已观看内容。只有网页可见字幕时，时间为近似值，滚动字幕可能有重复。`;
  $('audio-transcript').hidden=!data.audioTranscript;
  $('audio-text').textContent=data.audioTranscript?.segments.map(s=>`${time(s.start+(data.audioTranscript.metadata.videoOffset||0))} · ${s.speaker||'未确认'}\n${s.text}`).join('\n\n')||'';
  status('已自动保存在此浏览器的插件数据库中。导出后可直接交给 Codex。');render();
}
function filtered(){return data.rows.filter(r=>$('filter').value==='all'||r.speaker===$('filter').value);}
function render(){
  $('rows').replaceChildren();const rows=filtered();$('more').hidden=rows.length<=limit;
  for(const row of rows.slice(0,limit)){
    const article=document.createElement('article');
    const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(row.key);check.setAttribute('aria-label','选择 '+time(row.start));check.onchange=()=>check.checked?selected.add(row.key):selected.delete(row.key);
    const meta=document.createElement('div');const link=document.createElement('a');link.textContent=time(row.start);link.href=`https://www.youtube.com/watch?v=${encodeURIComponent(data.id)}&t=${Math.floor(row.start)}s`;link.target='_blank';link.rel='noopener';meta.append(link);
    const speaker=document.createElement('select');speaker.setAttribute('aria-label','人物 '+time(row.start));choices(speaker,[['','未确认'],...data.speakers.map(s=>[s,s])],row.speaker);
    speaker.onchange=()=>guard(async()=>{await send({type:'edit-transcript',id:data.id,patch:{assignments:[{key:row.key,speaker:speaker.value}]}});row.speaker=speaker.value;row.speakerSource='manual';row.needsSpeakerReview=false;status('人物标注已保存');});meta.append(speaker);
    if(row.speakerSource==='audio'){const note=document.createElement('small');note.className='hint';note.textContent='音频自动标注 · 待校对';meta.append(note);}
    if(row.turnHint){const hint=document.createElement('small');hint.className='hint';hint.textContent='原字幕含换人标记';meta.append(hint);}
    const text=document.createElement('div');const en=document.createElement('div');en.className='en';en.textContent=row.en;const zh=document.createElement('div');zh.className='zh';zh.textContent=row.zh||'尚未翻译';text.append(en,zh);article.append(check,meta,text);$('rows').append(article);
  }
}
async function guard(fn){try{await fn();}catch(e){status(e.message);}}
$('episodes').onchange=()=>{recognition?.cancel();guard(load);};$('refresh').onclick=()=>guard(loadList);
$('filter').onchange=()=>{limit=100;render();};$('more').onclick=()=>{limit+=100;render();};
$('select-all').onclick=()=>{for(const row of filtered())selected.add(row.key);render();};
$('apply').onclick=()=>guard(async()=>{if(!selected.size)return status('请先选择片段。');await send({type:'edit-transcript',id:data.id,patch:{assignments:[...selected].map(key=>({key,speaker:$('assign').value}))}});await load();status('人物标注已保存');});
$('save-meta').onclick=()=>guard(async()=>{
  // Retain names already assigned so an edited list cannot orphan existing labels.
  const speakers=[...new Set([...$('speakers').value.split('\n').map(s=>s.trim()).filter(Boolean),...data.rows.map(r=>r.speaker).filter(Boolean)])];
  await send({type:'edit-transcript',id:data.id,patch:{interviewee:$('interviewee').value,speakers}});await load();status('人物名单已保存。原来已使用的人物名称会保留；可批量重新标注片段。');
});
$('workflow').onclick=()=>guard(async()=>{if(data){const file=$('speaker-audio').files[0];if(file){if(sharedAudioURL)URL.revokeObjectURL(sharedAudioURL);sharedAudioURL=URL.createObjectURL(file);}await send({type:'open-workflow',id:data.id,audioURL:sharedAudioURL});}});
$('export').onclick=()=>guard(async()=>{
  if(!data)return;status('正在保存到文字稿目录…');const dir=await getDirectory();
  if(dir){const latest=(await send({type:'read-transcript',id:data.id})).episode;status('已保存：\n'+(await exportToDirectory(dir,latest)).join('\n'));}
  else {const r=await send({type:'export-transcript',id:data.id});status('已保存：\n'+r.paths.join('\n'));}
});
$('authorize').onclick=()=>guard(async()=>{
  const dir=await pickDirectory();status('目录已授权。');
  if(data){const latest=(await send({type:'read-transcript',id:data.id})).episode;status('已保存：\n'+(await exportToDirectory(dir,latest)).join('\n'));}
});
$('identify').onclick=()=>guard(async()=>{
  if(!data)return;
  const file=$('speaker-audio').files[0];if(!file)throw new Error('请选择与这期视频对应的原始音频。');
  const episodeId=data.id,offset=Number($('audio-offset').value);
  if(!Number.isFinite(offset)||offset<0)throw new Error('音频起点必须为非负秒数。');
  $('identify').disabled=true;$('cancel-identify').hidden=false;$('episodes').disabled=true;$('refresh').disabled=true;
  try {
    recognition=identifySpeakers(file,Number($('speaker-count').value),p=>{$('audio-status').textContent=`${p.stage} · ${p.percent}%`;},$('with-transcript').checked);
    const result=await recognition.result;
    await send({type:'apply-diarization',id:episodeId,result:{...result,offset}});
    await load();$('audio-status').textContent=`完成：检测到 ${result.speakerCount} 位说话人。已按音频时间轴标注；请校对自动标签和混合发言。`;
  } catch(e){$('audio-status').textContent=e.message;}
  finally{recognition=null;$('identify').disabled=false;$('cancel-identify').hidden=true;$('episodes').disabled=false;$('refresh').disabled=false;}
});
$('cancel-identify').onclick=()=>recognition?.cancel();
guard(loadList);
