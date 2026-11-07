import {DEFAULTS,apiEndpoint} from './core.js';
const $ = id => document.getElementById(id);
await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const s = await chrome.storage.local.get({...DEFAULTS, apiKey:''});
$('endpoint').value=s.baseUrl;$('model').value=s.model; $('fontSize').value=s.fontMode === 'fixed' ? String(s.fontSize) : 'match'; $('enabled').checked=s.enabled;
function hint(exists) {$('apiKey').placeholder=exists?'已保存密钥；留空保留，输入新值替换':'填写你的 API Key';}
hint(!!s.apiKey);
async function notify() {
  for (const tab of await chrome.tabs.query({url:'https://www.youtube.com/*'})) {
    chrome.tabs.sendMessage(tab.id,{type:'refresh-settings'}).catch(()=>{});
  }
}
async function save() {
  const baseUrl=$('endpoint').value.trim();const endpoint=apiEndpoint(baseUrl);
  if(!$('model').value.trim())throw new Error('请填写模型名称');
  if(!await chrome.permissions.request({origins:[new URL(endpoint).origin+'/*']}))throw new Error('需要允许访问所选 API 服务');
  const settings={baseUrl,model:$('model').value,fontMode:$('fontSize').value === 'match' ? 'match' : 'fixed',fontSize:Number($('fontSize').value)||25,enabled:$('enabled').checked};
  const key=$('apiKey').value.trim(); if(key) settings.apiKey=key;
  await chrome.storage.local.set(settings); $('apiKey').value='';
  hint(!!(await chrome.storage.local.get('apiKey')).apiKey); await notify();
}
$('settings').addEventListener('submit',async e=>{e.preventDefault();try{await save();$('status').textContent='已保存。回到 YouTube 即可生效。';}catch{$('status').textContent='保存失败，请重新打开设置。';}});
$('test').onclick=async()=>{
  $('test').disabled=true;$('status').textContent='正在测试翻译…';
  try{await save();const start=performance.now();const r=await chrome.runtime.sendMessage({type:'test'});$('status').textContent=r.ok?`连接成功 · ${((performance.now()-start)/1000).toFixed(1)} 秒\n${r.text}`:r.error;}
  catch{$('status').textContent='连接失败，请重试。';}finally{$('test').disabled=false;}
};
$('clear').onclick=async()=>{await chrome.storage.local.remove('apiKey');$('apiKey').value='';hint(false);await notify();$('status').textContent='密钥已删除。';};
