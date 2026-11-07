(() => {
  const contrast = new globalThis.ChillTongAdaptiveContrast();
  let config = {enabled:false}, player, host, line, badge, control;
  let reviewControl;
  let sourceStart = 0, sourceKey = "";
  let lastCC = null, enabling = false, captionRoot, captionObserver;
  let current = '', changedAt = 0, lastSent = '', lastRequest = 0, busy = false;
  let cues = [], translations = new Map(), trackVideo = '';
  let generation = 0, requestId = 0, retryAt = 0, videoId = '', boundVideo;
  const normalize = text => text.replace(/\s+/g, ' ').trim().slice(0,1800);
  const send = message => chrome.runtime.sendMessage(message);
  window.addEventListener('message', event => {
    const d = event.data;
    if(event.source !== window || event.origin !== location.origin || d?.source !== 'chilltong-captions-v1' || typeof d.text !== 'string' || d.text.length > 5000000) return;
    try {
      const u = new URL(d.url,location.href);
      if(u.origin !== location.origin || u.pathname !== '/api/timedtext' || !/^en(?:-|$)/i.test(u.searchParams.get('lang')||'') || u.searchParams.has('tlang')) return;
      const id = u.searchParams.get('v');
      if(!id || id !== new URL(location.href).searchParams.get('v')) return;
      let rows;
      if(d.text.trim().startsWith('{')) {
        const data = JSON.parse(d.text);
        rows = (data.events || []).filter(e=>e.segs?.length).map(e=>({start:e.tStartMs/1000,duration:(e.dDurationMs||3000)/1000,text:normalize(e.segs.map(s=>s.utf8||'').join(''))}));
      } else {
        const xml = new DOMParser().parseFromString(d.text,'text/xml');
        rows = [...xml.querySelectorAll('text, p')].map(e=>({start:e.hasAttribute('t')?Number(e.getAttribute('t'))/1000:Number(e.getAttribute('start')),duration:e.hasAttribute('d')?Number(e.getAttribute('d'))/1000:Number(e.getAttribute('dur')||3),text:normalize(e.textContent)}));
      }
      rows = rows.filter(x=>x.text && Number.isFinite(x.start) && x.start>=0).sort((a,b)=>a.start-b.start).slice(0,30000);
      if(trackVideo === id && rows.length === cues.length && rows.every((row,i) => row.start === cues[i].start && row.duration === cues[i].duration && row.text === cues[i].text)) return;
      if(rows.length) {reset(); cues=rows.map((x,i)=>({...x,id:String(i)}));translations.clear();trackVideo=id;}
    } catch {}
  });
  function saveRows(rows) {
    const title=document.querySelector('h1.ytd-watch-metadata, h1.title')?.textContent?.trim() || document.title.replace(/ - YouTube$/, '');
    send({type:'record',title,rows}).then(result=>{
      if(!result.ok && badge) badge.textContent='文字稿暂存失败：'+result.error;
    }).catch(()=>{if(badge)badge.textContent='文字稿暂存失败，请刷新页面';});
  }
  function cueIndexAt(time) {
    let lo = 0, hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid].start <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
  function renderTimeline() {
    if (!line || !boundVideo || host.hidden || trackVideo !== videoId || !cues.length) return;
    // Read the actual CC state as well: a frame can arrive before the control poll.
    if (player.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'false') {
      if (line.textContent) line.textContent = '';
      return;
    }
    const time = boundVideo.currentTime;
    const cue = cues[cueIndexAt(time)];
    const text = cue && time < cue.start + cue.duration && normalize(subtitles())
      ? translations.get(cue.id) || '' : '';
    if (line.textContent !== text) line.textContent = text;
  }
  async function timelineTick(video, now) {
    renderTimeline();
    if(busy || now<retryAt) return;
    const time = video.currentTime;
    const index = cueIndexAt(time);
    const first = Math.max(0, index);
    // Time-based lookahead keeps short and long cues equally well buffered.
    // A small first batch makes the current subtitle available sooner.
    const limit = translations.size === 0 ? 4 : 16;
    const items = [];
    const horizon = time + Math.max(45, 30 * (video.playbackRate || 1));
    for (let i = first; i < cues.length && items.length < limit; i++) {
      const cue = cues[i];
      if (cue.start > horizon) break;
      if (i === index && time >= cue.start + cue.duration) continue;
      if (!translations.has(cue.id)) items.push(cue);
    }
    if(!items.length) {badge.textContent='';return;}
    busy=true; const g=generation, r=++requestId;
    badge.textContent=line.textContent?'':'双语字幕 · 预译接下来的字幕…';
    try {
      const result=await send({type:'batch',items:items.map(({id,text})=>({id,text}))});
      if(g!==generation || r!==requestId) return;
      if(!result.ok) throw new Error(result.error);
      for(const item of result.items) translations.set(item.id,item.text);
      saveRows(items.map(c=>({start:c.start,end:c.start+c.duration,en:c.text,zh:translations.get(c.id),source:'timeline'})));
      badge.textContent='';
      renderTimeline();
    } catch(error) {if(g===generation){badge.textContent=error.message;retryAt=Date.now()+5000;}}
    finally {
      if(r===requestId) {
        busy=false;
        // Fill the rest of the horizon without waiting for another polling tick.
        if(g===generation && config.enabled && lastCC && !host.hidden && Date.now()>=retryAt && player.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') !== 'false')
          queueMicrotask(() => timelineTick(video,Date.now()).catch(()=>{}));
      }
    }
  }
  function reset() {
    generation++; requestId++; busy = false; current = ''; lastSent = ''; retryAt = 0;
    if (line) line.textContent = '';
    send({type:'cancel'}).catch(() => {});
  }
  async function loadSettings() {
    try { const s = await send({type:'settings'}); if (s.ok) {if(config.model && config.model !== s.model) translations.clear(); config=s; reset();} } catch {}
  }
  async function enableFromCC() {
    if (config.enabled || enabling) return;
    enabling = true;
    try {
      const result = await send({type:'enable-translation'});
      if (result.ok) {config.enabled = true; reset();}
    } catch {} finally {enabling = false;}
  }
  function syncControls() {
    const controls = player.querySelector('.ytp-right-controls');
    const cc = player.querySelector('.ytp-subtitles-button');
    if (controls && (!control?.isConnected || control.parentElement !== controls)) {
      control?.remove();
      control = document.createElement('button');
      control.type = 'button';
      control.className = 'ytp-button chilltong-translate-button';
      control.textContent = '译';
      control.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const nativeCC = player.querySelector('.ytp-subtitles-button');
        if (!nativeCC || nativeCC.disabled || nativeCC.getAttribute('aria-disabled') === 'true') return;
        // Both the built-in CC and this shortcut control the same subtitle state.
        nativeCC.click();
      });
      controls.prepend(control);
    }
    // Keep the shortcut before other controls, including late-injected translation icons.
    if (controls && control && controls.firstElementChild !== control) controls.prepend(control);
    if(controls && (!reviewControl?.isConnected || reviewControl.parentElement!==controls)) {
      reviewControl?.remove();reviewControl=document.createElement('button');
      reviewControl.type='button';reviewControl.className='ytp-button chilltong-review-button';reviewControl.textContent='稿';
      reviewControl.title='双语文字稿 · 人物标注 · 保存复习';reviewControl.setAttribute('aria-label','打开双语文字稿');
      reviewControl.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();send({type:'open-transcript'}).catch(()=>{});});
      controls.insertBefore(reviewControl,control?.nextSibling||null);
    }
    const pressed = cc?.getAttribute('aria-pressed');
    const on = pressed === 'true' || (pressed == null && !!normalize(subtitles()));
    if (on !== lastCC) {
      lastCC = on;
      reset();
      if (on) enableFromCC();
    }
    if (control) {
      control.disabled = !cc || cc.disabled || cc.getAttribute('aria-disabled') === 'true';
      control.hidden = !videoId || player.classList.contains('ad-showing');
      const active = on && config.enabled;
      control.setAttribute('aria-pressed', String(active));
      control.setAttribute('aria-label', active ? '关闭双语字幕（CC）' : '开启双语字幕（CC）');
      control.title = control.disabled ? '此视频暂未提供可开启的字幕' :
        `${active ? '关闭' : '开启'}双语字幕 · ${config.model || '未配置模型'}`;
    }
    return on;
  }
  function mount(p) {
    contrast.clear(player); host?.remove(); control?.remove(); reviewControl?.remove(); lastCC = null; player?.classList.remove('chilltong-wide-captions'); player = p;
    host = document.createElement('div'); host.id = 'chilltong-subtitles';
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:60;';
    const shadow = host.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}.line{position:absolute;left:3%;right:3%;bottom:120px;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;font:400 25px/1.4 system-ui,"PingFang SC",sans-serif;color:#fff;text-shadow:var(--ct-subtitle-shadow,none)}.line span{background:transparent;box-shadow:none;padding:0;border-radius:0}.badge{position:absolute;top:55px;right:18px;max-width:75%;color:#eee;background:#171717d9;border-radius:6px;padding:5px 9px;font:12px/1.5 system-ui}.badge:empty,.line span:empty{display:none}';
    const wrap = document.createElement('div'); wrap.className = 'line';
    line = document.createElement('span'); wrap.append(line);
    badge = document.createElement('div'); badge.className = 'badge';
    shadow.append(style, wrap, badge); player.append(host); reset();
  }
  function subtitles() {
    return [...player.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .map(el => el.textContent).join(' ');
  }
  async function tick() {
    const id = new URL(location.href).searchParams.get('v') || '';
    if (videoId !== id) {videoId = id; lastCC = null; reset(); if(trackVideo !== id) {cues=[];translations.clear();}}
    const p = document.querySelector('#movie_player');
    if (!p) {contrast.clear(player);host?.remove(); control?.remove(); reviewControl?.remove(); captionObserver?.disconnect(); captionRoot=null; if(player) reset(); player = null; return;}
    if (player !== p || !host?.isConnected) mount(p);
    const video = p.querySelector('video');
    if (video !== boundVideo) {
      boundVideo?.removeEventListener('seeking', reset);
      boundVideo = video; video?.addEventListener('seeking', reset);
    }
    const root = p.querySelector('.ytp-caption-window-container');
    if (root !== captionRoot) {
      captionObserver?.disconnect();
      captionRoot = root;
      if (root) {
        captionObserver = new MutationObserver(renderTimeline);
        captionObserver.observe(root, {subtree:true, childList:true, characterData:true});
      }
    }
    const ccOn = syncControls();
    host.hidden = !config.enabled || !ccOn || !id || p.classList.contains('ad-showing');
    host.style.display = host.hidden ? 'none' : 'block';
    p.classList.toggle('chilltong-wide-captions', !host.hidden);
    if (host.hidden) {contrast.clear(p);if(current || busy) reset(); badge.textContent = ''; return;}
    const english = [...p.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment')]
      .find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const englishSize = english ? parseFloat(getComputedStyle(english).fontSize) : 0;
    const fontSize = config.fontMode !== 'fixed' && englishSize > 0 ? englishSize : config.fontSize || 25;
    line.parentElement.style.fontSize = `${fontSize}px`;
    const caption = p.querySelector('.caption-window');
    const bottom = caption ? p.getBoundingClientRect().bottom - caption.getBoundingClientRect().top + 10 : 110;
    line.parentElement.style.bottom = `${Math.max(70, Math.min(p.clientHeight - 80, bottom))}px`;
    contrast.update(p,video,[...p.querySelectorAll('.ytp-caption-segment'),line],true);
    if (!config.configured) {badge.textContent = '双语字幕 · 请先在插件设置中填写 API Key'; return;}
    if(cues.length && trackVideo===id && video) {await timelineTick(video,Date.now());return;}
    const text = normalize(subtitles());
    const now = Date.now();
    if (text !== current) {
      // Preserve an in-progress prefix translation only while the same rolling cue grows.
      if (!text.startsWith(current) || !current) line.textContent = '';
      if(!text.startsWith(current) || !current) {sourceStart=video?.currentTime||0;sourceKey=String(Math.round(sourceStart*1000));}
      current = text; changedAt = now;
      if (!text) {line.textContent = ''; lastSent = '';}
    }
    if (!text) {badge.textContent = '双语字幕 · 等待英文字幕（请开启 CC 并选择英语）'; return;}
    if (busy || now < retryAt) return;
    if (text === lastSent) return;
    // Stable captions wait 250ms; rolling ASR is sampled at most once per second.
    if (now - changedAt < 250 && now - lastRequest < 1200) return;
    lastRequest = now; lastSent = text; busy = true;
    const g = generation, r = ++requestId, capturedStart=sourceStart, capturedKey=sourceKey;
    badge.textContent = '双语字幕 · 翻译中';
    try {
      const result = await send({type:'translate', text});
      if (g !== generation || r !== requestId) return;
      if (!result.ok) throw new Error(result.error);
      saveRows([{key:'visible:'+capturedKey,start:capturedStart,end:video?.currentTime||capturedStart,en:text,zh:result.text,source:'visible'}]);
      if (current === text || current.startsWith(text)) line.textContent = result.text;
      badge.textContent = '';
    } catch (error) {
      if (g === generation) {badge.textContent = error.message || '翻译连接中断，请刷新页面'; lastSent = ''; retryAt = Date.now()+5000;}
    } finally {if(r === requestId) busy=false;}
  }
  chrome.runtime.onMessage.addListener(msg => {if(msg.type === 'refresh-settings') loadSettings();});
  document.addEventListener('yt-navigate-start', reset);
  loadSettings();
  function renderFrame() {
    renderTimeline();
    requestAnimationFrame(renderFrame);
  }
  requestAnimationFrame(renderFrame);
  setInterval(() => tick().catch(() => {}), 150);
})();
