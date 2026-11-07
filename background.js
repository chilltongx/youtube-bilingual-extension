import {record, episode, listEpisodes, editEpisode, applyDiarization,saveReview,prepareBlog,savePublished} from './transcripts.js';
import {DEFAULTS, apiEndpoint, normalize, publicSettings, bodyFor, readResponse, parseBatch} from './core.js';
// Never expose the key to content scripts (or to the YouTube page).
const ready = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
const cache = new Map();
const active = new Map();
let cooldown = 0;
chrome.storage.onChanged.addListener(() => { cache.clear(); for (const c of active.values()) c.abort(); });
async function settings() { await ready; return chrome.storage.local.get(DEFAULTS); }
async function translate(text, tabId, test = false, batch = false) {
  const s = await settings();
  const {apiKey} = await chrome.storage.local.get('apiKey');
  if (!s.model) throw new Error('请先配置模型名称。');
  if (!apiKey) throw new Error('请点击插件图标，在设置中填写 API Key。');
  if (!s.enabled && !test) throw new Error('翻译已关闭');
  text = batch ? text : normalize(text);
  if (!text) return '';
  const key = `${s.model}:${batch}:${text}`;
  if (cache.has(key)) return cache.get(key);
  if (Date.now() < cooldown) throw new Error('API 限流，稍后自动恢复。');
  active.get(tabId)?.abort();
  const controller = new AbortController();
  active.set(tabId, controller);
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(apiEndpoint(s.baseUrl), {method: 'POST', redirect: 'error', signal: controller.signal,
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`}, body: JSON.stringify(bodyFor(text, s.model, batch,s))});
    if (!response.ok) {
      if (response.status === 429) cooldown = Date.now() + 30000;
      throw new Error(({401:'API Key 无效或已过期。',403:'此 Key 无权使用该模型。',429:'API 限流，30 秒后重试。'})[response.status] || `翻译服务错误（HTTP ${response.status}）`);
    }
    const result = await readResponse(response);
    cache.set(key, result);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('翻译超时或已取消，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接翻译服务，请检查网络。');
    throw error;
  } finally { clearTimeout(timeout); if (active.get(tabId) === controller) active.delete(tabId); }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
  const youtube = sender.tab && sender.url?.startsWith('https://www.youtube.com/');
  if (!trusted && !youtube) return;
  (async () => {
    if (msg.type === 'record' && youtube) {
      const id=new URL(sender.tab.url || sender.url).searchParams.get('v');
      if(!id || !/^[\w-]{1,80}$/.test(id) || !Array.isArray(msg.rows) || msg.rows.length>16) throw new Error('无效的字幕记录');
      return await record(id, String(msg.title||'').slice(0,250),msg.rows);
    }
    if (msg.type === 'open-transcript' && (youtube || trusted)) {
      const id=youtube?new URL(sender.tab.url || sender.url).searchParams.get('v'):'';
      await chrome.tabs.create({url:chrome.runtime.getURL('transcript.html')+(id?'?v='+encodeURIComponent(id):'')});return {};
    }
    if (msg.type === 'list-transcripts' && trusted) return {episodes:await listEpisodes()};
    if (msg.type === 'read-transcript' && trusted) return {episode:await episode(msg.id)};
    if (msg.type === 'apply-diarization' && trusted) return {episode:await applyDiarization(msg.id,msg.result)};
    if (msg.type === 'edit-transcript' && trusted) return {episode:await editEpisode(msg.id,msg.patch||{})};
    if (msg.type === 'export-transcript' && trusted) {
      const data=await episode(msg.id);if(!data)throw new Error('文字稿不存在');
      try {return await chrome.runtime.sendNativeMessage('com.chilltong.transcripts',{action:'export',episode:data});}
      catch {throw new Error('本机保存助手尚未安装或不可用；文字稿仍已保存在插件中。');}
    }
    if(msg.type==='preview-audio' && trusted){const {audioPreview}=await chrome.storage.session.get('audioPreview');return {url:audioPreview?.id===msg.id?audioPreview.url:null};}
    if(msg.type==='open-workflow' && trusted){if(typeof msg.audioURL==='string' && msg.audioURL.startsWith('blob:'+chrome.runtime.getURL('')))await chrome.storage.session.set({audioPreview:{id:msg.id,url:msg.audioURL}});else await chrome.storage.session.remove('audioPreview');await chrome.tabs.create({url:chrome.runtime.getURL('workflow.html')+'?v='+encodeURIComponent(msg.id)});return {};}
    if(msg.type==='check-blog' && trusted){try{return await chrome.runtime.sendNativeMessage('com.chilltong.blog',{action:'check'});}catch{throw new Error('本机发布助手尚未就绪，请检查安装。');}}
    if(msg.type==='save-review' && trusted)return {episode:await saveReview(msg.id,msg.patch||{})};
    if(msg.type==='prepare-blog' && trusted)return {prepared:await prepareBlog(msg.id)};
    if(msg.type==='publish-blog' && trusted){
      const e=await episode(msg.id),draft=e?.blogDraft;
      if(!draft || draft.hash!==msg.hash)throw new Error('稿件已更改，请重新预览后发布。');
      let result;
      try{result=await chrome.runtime.sendNativeMessage('com.chilltong.blog',{action:'publish',snapshot:draft.snapshot,hash:draft.hash});}
      catch{throw new Error('本机发布助手无法连接，请确认安装与 SSH 网络；尚无法确认发布结果。');}
      if(!result.ok)throw new Error(result.error||'发布失败');
      await savePublished(msg.id,result);return result;
    }
    if (msg.type === 'settings') {
      const s = await settings();
      const {apiKey} = await chrome.storage.local.get('apiKey');
      return publicSettings({...s, apiKey});
    }
    if (msg.type === 'enable-translation' && youtube) {
      await ready;
      await chrome.storage.local.set({enabled:true});
      const tabs = await chrome.tabs.query({url:'https://www.youtube.com/*'});
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id,{type:'refresh-settings'}).catch(()=>{});
      return {};
    }
    if (msg.type === 'translate' && youtube) return {text: await translate(msg.text, sender.tab.id)};
    if (msg.type === 'batch' && youtube) {
      if (!Array.isArray(msg.items) || !msg.items.length || msg.items.length > 16) throw new Error('字幕批次无效');
      const items = msg.items.map(x => ({id: String(x.id).slice(0,80), text: normalize(x.text)}));
      return {items: parseBatch(await translate(JSON.stringify(items), sender.tab.id, false, true), items)};
    }
    if (msg.type === 'cancel' && youtube) { active.get(sender.tab.id)?.abort(); return {}; }
    if (msg.type === 'test' && trusted) return {text: await translate('Welcome back to the podcast. Today we explore how artificial intelligence changes the way we work.', 'test', true)};
    throw new Error('不支持的操作');
  })().then(data => reply({ok: true, ...data}), error => reply({ok: false, error: error.message}));
  return true;
});
chrome.tabs.onRemoved.addListener(id => {active.get(id)?.abort(); active.delete(id);});
