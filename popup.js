(async()=>{
  const s=await chrome.runtime.sendMessage({type:'settings'});
  document.getElementById('enabled').checked=s.enabled;
  document.getElementById('status').textContent=s.configured?'已配置 · '+s.model+'':'首次使用，请先填写 API Key。';
  document.getElementById('transcript').onclick=()=>chrome.runtime.sendMessage({type:'open-transcript'});
  document.getElementById('settings').onclick=()=>chrome.runtime.openOptionsPage();
  document.getElementById('enabled').onchange=async e=>{
    await chrome.storage.local.set({enabled:e.target.checked});
    for(const tab of await chrome.tabs.query({url:'https://www.youtube.com/*'})) chrome.tabs.sendMessage(tab.id,{type:'refresh-settings'}).catch(()=>{});
  };
})();
