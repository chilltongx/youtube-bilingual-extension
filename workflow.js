import {stamp,unresolvedRows} from './blog-publication.js';
const $=id=>document.getElementById(id),id=new URL(location.href).searchParams.get('v');
let episode,prepared,limit=100,audioURL,stopAt,splitKey;
const send=async m=>{const r=await chrome.runtime.sendMessage(m);if(!r.ok)throw new Error(r.error||'操作失败');return r;};
function status(text){$('status').textContent=text;}
function invalidate(){prepared=null;$('publish').disabled=true;$('preview-info').textContent='内容有修改，需要重新生成预览。';}
function dirty(event){invalidate();if(event?.target?.id!=='reviewed')$('reviewed').checked=false;}
async function guard(fn){try{await fn();}catch(e){status(e.message);}}
function select(element,values,value){element.replaceChildren();for(const [v,label]of values){const o=document.createElement('option');o.value=v;o.textContent=label;element.append(o);}element.value=value||'';}
function sample(start,end){
  if(!audioURL){window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.floor(start)}s`,'_blank','noopener');return;}
  const offset=episode.audioTranscript?.metadata.videoOffset??episode.diarization?.offset??0;
  const t=start-offset;if(t<0){status('这个片段不在所选音频覆盖范围内。');return;}
  stopAt=Math.max(t+0.2,Math.min(end-offset,t+12));$('player').currentTime=t;$('player').play().catch(()=>status('请先点击音频播放器播放一次。'));
}
$('player').ontimeupdate=()=>{if(stopAt!=null&&$('player').currentTime>=stopAt){$('player').pause();stopAt=null;}};
$('sample-audio').onchange=()=>{if(audioURL)URL.revokeObjectURL(audioURL);const file=$('sample-audio').files[0];audioURL=file?URL.createObjectURL(file):null;$('player').src=audioURL||'';};
async function load(){episode=(await send({type:'read-transcript',id})).episode;if(!episode)throw new Error('文字稿不存在，请先在视频中积累字幕。');render();}
function render(){
  const p=episode.publication||{};
  $('title').value=p.title||episode.title;$('description').value=p.description||'';$('introduction').value=p.introduction||'';$('category').value=p.category||'linux';$('reviewed').checked=!!p.reviewed;
  $('identities').replaceChildren();
  const labels=[...new Set(episode.rows.filter(r=>!r.excluded).map(r=>r.speaker).filter(s=>s&&s!=='多人／待拆分'))];
  for(const label of labels){
    const identity=episode.identities?.[label]||{},card=document.createElement('div');card.className='identity';card.dataset.label=label;
    const h=document.createElement('h3');h.textContent=label;card.append(h);
    const grid=document.createElement('div');grid.className='identity-grid';
    for(const [field,title]of [['name','真实姓名或确认的称呼'],['role','角色／说明']]){const l=document.createElement('label');l.textContent=title;const input=document.createElement('input');input.dataset.field=field;input.value=identity[field]||'';input.oninput=()=>{card.querySelector('[data-field="confirmed"]').checked=false;dirty();};l.append(input);grid.append(l);}card.append(grid);
    const checkLabel=document.createElement('label');checkLabel.className='switch';const check=document.createElement('input');check.type='checkbox';check.dataset.field='confirmed';check.checked=!!identity.confirmed;check.onchange=dirty;checkLabel.append(check,document.createTextNode('我已核对代表片段，确认此人物身份'));card.append(checkLabel);
    const samples=episode.rows.filter(r=>r.speaker===label&&!r.excluded).sort((a,b)=>(b.end-b.start)-(a.end-a.start)).slice(0,3).sort((a,b)=>a.start-b.start);
    for(const r of samples){const block=document.createElement('div');block.className='sample';const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='试听／看视频 '+stamp(r.start);button.onclick=()=>sample(r.start,r.end);const text=document.createElement('span');text.textContent=(r.editedZh??r.zh)||r.en;block.append(button,text);card.append(block);}
    $('identities').append(card);
  }
  if(!labels.length)$('identities').textContent='还没有已分组的说话人。可先在「稿」页运行自动识别，或在下方为片段选择说话人，再保存。';
  $('unresolved').textContent=`共 ${episode.rows.length} 段，${unresolvedRows(episode).length} 段人物尚未确认。可修正人物、拆分混合发言，或取消收录该片段。`;
  $('review-rows').replaceChildren();$('more').hidden=episode.rows.length<=limit;
  const choices=[['','未确认'],...episode.speakers.map(s=>[s,episode.identities?.[s]?.name?`${s} · ${episode.identities[s].name}`:s])];
  for(const r of episode.rows.slice(0,limit)){
    const article=document.createElement('article');article.className='review-row';article.dataset.key=r.key;
    const top=document.createElement('div');top.className='row-heading';const time=document.createElement('button');time.className='secondary';time.textContent=stamp(r.start);time.onclick=()=>sample(r.start,r.end);
    const who=document.createElement('select');who.dataset.field='speaker';who.setAttribute('aria-label','片段人物 '+stamp(r.start));select(who,choices,r.speaker);who.onchange=dirty;
    const include=document.createElement('label');include.className='switch';const check=document.createElement('input');check.type='checkbox';check.dataset.field='include';check.checked=!r.excluded;check.onchange=dirty;include.append(check,document.createTextNode('收录'));
    const split=document.createElement('button');split.className='secondary';split.textContent='拆成两段';split.onclick=()=>guard(async()=>{await save();splitKey=r.key;const row=episode.rows.find(x=>x.key===r.key);$('split-time').value=(row.start+row.end)/2;for(let i=0;i<2;i++){select($('split-speaker-'+i),choices,row.speaker);$('split-en-'+i).value=i?'':row.editedEn??row.en;$('split-zh-'+i).value=i?'':row.editedZh??row.zh;}$('split-error').textContent='';$('split').showModal();});
    top.append(time,who,include,split);article.append(top);
    for(const [field,label,value]of [['zh','中文',r.editedZh??r.zh],['en','英文',r.editedEn??r.en]]){const l=document.createElement('label');l.textContent=label;const text=document.createElement('textarea');text.rows=2;text.dataset.field=field;text.value=value;text.oninput=dirty;l.append(text);article.append(l);}
    $('review-rows').append(article);
  }
}
async function save(){
  const identities=[...document.querySelectorAll('.identity')].map(c=>({label:c.dataset.label,name:c.querySelector('[data-field="name"]').value,role:c.querySelector('[data-field="role"]').value,confirmed:c.querySelector('[data-field="confirmed"]').checked}));
  const rows=[...document.querySelectorAll('.review-row')].map(c=>({key:c.dataset.key,speaker:c.querySelector('[data-field="speaker"]').value,en:c.querySelector('[data-field="en"]').value,zh:c.querySelector('[data-field="zh"]').value,excluded:!c.querySelector('[data-field="include"]').checked}));
  const publication={title:$('title').value,category:$('category').value,description:$('description').value,introduction:$('introduction').value,reviewed:$('reviewed').checked};
  episode=(await send({type:'save-review',id,patch:{identities,rows,publication}})).episode;invalidate();
}
$('save').onclick=()=>guard(async()=>{await save();render();status('人物确认与校对已保存。');});
$('more').onclick=()=>guard(async()=>{await save();limit+=100;render();});
$('save-split').onclick=async()=>{try{episode=(await send({type:'save-review',id,patch:{split:{key:splitKey,time:Number($('split-time').value),parts:[0,1].map(i=>({speaker:$('split-speaker-'+i).value,en:$('split-en-'+i).value,zh:$('split-zh-'+i).value}))}}})).episode;$('split').close();invalidate();render();}catch(e){$('split-error').textContent=e.message;}};
for(const field of ['title','description','introduction','category','reviewed'])$(field).addEventListener('input',dirty);
$('check-connection').onclick=()=>guard(async()=>{status('正在检查发布连接…');await send({type:'check-blog'});status('发布连接正常。尚未上传任何稿件。');});
$('preview').onclick=()=>guard(async()=>{
  await save();prepared=(await send({type:'prepare-blog',id})).prepared;
  $('preview-frame').srcdoc=prepared.html.replace(`<link rel="stylesheet" href="/${prepared.cssPath}">`,`<style>${prepared.css}</style>`);$('preview-frame').hidden=false;
  $('preview-info').textContent=`预览快照：${prepared.snapshot.rows.length} 段 · 发布地址 ${prepared.url}。只发布当前预览，不包括之后新积累的内容。`;
  $('publish').disabled=false;status('预览已生成，尚未上传。确认下方效果后点击发布。');
});
$('publish').onclick=()=>guard(async()=>{
  if(!prepared)throw new Error('请先生成预览');$('publish').disabled=true;$('preview').disabled=true;status('正在发布：备份、更新文章和 Blog 入口、校验线上内容…');
  try{const r=await send({type:'publish-blog',id,hash:prepared.hash});$('published').replaceChildren();const a=document.createElement('a');a.href=r.url;a.target='_blank';a.rel='noopener';a.textContent='打开已发布文章';$('published').append(a,document.createTextNode(`\n备份：${r.backup}\n${r.sourceWarning||'文章、列表、RSS 与 sitemap 已验证。'}`));status('发布成功。');}
  finally{$('preview').disabled=false;$('publish').disabled=!prepared;}
});
guard(async()=>{await load();const r=await send({type:'preview-audio',id});if(r.url){audioURL=r.url;$('player').src=audioURL;}});
