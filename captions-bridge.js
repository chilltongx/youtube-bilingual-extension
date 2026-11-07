// Observe only YouTube caption responses already requested by the player.
// No credentials, extension APIs, or arbitrary URL requests cross this bridge.
(() => {
  function relevant(url) {
    try {const u=new URL(url,location.href);return u.origin===location.origin && u.pathname==='/api/timedtext' && /^en(?:-|$)/i.test(u.searchParams.get('lang')||'') && !u.searchParams.has('tlang');} catch {return false;}
  }
  function publish(url, text) {
    if (typeof text==='string' && text.length<5000000) window.postMessage({source:'chilltong-captions-v1',url,text},location.origin);
  }
  const originalFetch=window.fetch;
  window.fetch=async function(...args) {
    const result=await Reflect.apply(originalFetch,this,args);
    const url=typeof args[0]==='string'?args[0]:args[0]?.url;
    if(relevant(url)) result.clone().text().then(text=>publish(url,text)).catch(()=>{});
    return result;
  };
  const open=XMLHttpRequest.prototype.open, send=XMLHttpRequest.prototype.send;
  const urls=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,String(url));return Reflect.apply(open,this,[method,url,...rest]);};
  XMLHttpRequest.prototype.send=function(...args){
    const url=urls.get(this);
    if(relevant(url)) this.addEventListener('load',()=>{try{publish(url,this.responseType==='json'?JSON.stringify(this.response):this.responseText);}catch{}},{once:true});
    return Reflect.apply(send,this,args);
  };
})();
