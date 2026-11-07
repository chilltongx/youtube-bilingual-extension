from playwright.sync_api import sync_playwright
from pathlib import Path
import tempfile,json,os
ROOT=Path(__file__).resolve().parents[1]
CHROME=os.environ.get('CHROME_PATH')
with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
    context=p.chromium.launch_persistent_context(profile,executable_path=CHROME,headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    ext=worker.url.split('/')[2]
    worker.evaluate('''() => {globalThis.calls=0;globalThis.fetch=async (url,options)=>{globalThis.calls++;
      const b=JSON.parse(options.body); const input=b.input[0].content[0].text;
      let text='欢迎回到播客。';
      try {const rows=JSON.parse(input);if(Array.isArray(rows))text=JSON.stringify(rows.map(x=>({id:x.id,text:'中文：'+x.text})));}catch{}
      await new Promise(r=>setTimeout(r,200));
      return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\\n\\ndata: '+JSON.stringify({type:'response.completed',response:{}})+'\\n\\n',{headers:{'content-type':'text/event-stream'}});
    };}''')
    options=context.new_page();options.on('pageerror',lambda e:print('PAGE ERROR',e.stack,flush=True));options.goto(f'chrome-extension://{ext}/options.html')
    options.wait_for_timeout(500)
    print('options ready',flush=True)
    options.locator('#model').fill('test-model')
    options.evaluate("chrome.permissions.request=async()=>true")
    options.get_by_label('API Key',exact=True).fill('test-only-not-a-real-key')
    options.get_by_role('button',name='保存设置').click()
    print('saved',options.url,flush=True)
    options.get_by_role('button',name='测试翻译').click()
    options.wait_for_timeout(1500)
    print('test result',options.locator('#status').inner_text(),flush=True)
    options.get_by_text('连接成功',exact=False).wait_for()
    (ROOT/'test-artifacts').mkdir(exist_ok=True)
    options.screenshot(path=str(ROOT/'test-artifacts/settings.png'),full_page=True)
    page=context.new_page()
    html='''<html><body style="margin:0;background:#161b19;color:white"><div id="movie_player" style="width:1000px;height:570px;position:relative;background:linear-gradient(135deg,#20382f,#101715)"><video></video><div style="padding:70px;font:32px system-ui">Podcast · Test fixture</div><div class="ytp-caption-window-container"><div class="caption-window" style="position:absolute;bottom:55px;left:20%;font:24px system-ui"><span class="ytp-caption-segment">Welcome back to the podcast.</span></div></div><div class="ytp-right-controls" style="position:absolute;bottom:0;right:10px"><button class="ytp-subtitles-button" aria-pressed="true" onclick="const on=this.getAttribute('aria-pressed')!=='true';this.setAttribute('aria-pressed',String(on));document.querySelector('.ytp-caption-window-container').style.display=on?'block':'none'">CC</button></div></div></body></html>'''
    page.route('https://www.youtube.com/**',lambda route:route.fulfill(body=html,content_type='text/html'))
    page.goto('https://www.youtube.com/watch?v=fixture')
    page.get_by_text('欢迎回到播客。',exact=True).wait_for(timeout=15000)
    assert page.locator('.ytp-caption-segment').inner_text()=='Welcome back to the podcast.'
    # Caption clearing cannot leave the previous translation onscreen.
    page.locator('.ytp-caption-segment').evaluate("e=>e.textContent=''")
    page.wait_for_timeout(400)
    assert page.locator('#chilltong-subtitles .line span').inner_text()==''
    # A captured English timeline enables batch pretranslation.
    page.locator('.ytp-caption-segment').evaluate("e=>e.textContent='First caption'")
    track={'events':[{'tStartMs':0,'dDurationMs':5000,'segs':[{'utf8':'First caption'}]},{'tStartMs':5000,'dDurationMs':5000,'segs':[{'utf8':'Second caption'}]}]+[{'tStartMs':10000+i*1000,'dDurationMs':1000,'segs':[{'utf8':'Future '+str(i)}]} for i in range(40)]}
    page.route('https://www.youtube.com/api/timedtext*',lambda route:route.fulfill(body=json.dumps(track),content_type='application/json'))
    page.evaluate("fetch('/api/timedtext?v=fixture&lang=en').then(r=>r.json())")
    page.get_by_text('中文：First caption',exact=True).wait_for()
    page.evaluate("fetch('/api/timedtext?v=fixture&lang=en').then(r=>r.json())")
    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert page.locator('#chilltong-subtitles .line span').inner_text()=='中文：First caption'
    page.screenshot(path=str(ROOT/'test-artifacts/subtitles.png'))
    page.evaluate("document.querySelector('video').currentTime=6;document.querySelector('video').dispatchEvent(new Event('seeking'));document.querySelector('.ytp-caption-segment').textContent='Second caption'")
    page.get_by_text('中文：Second caption',exact=True).wait_for()
    # Cached cue transitions must be painted immediately, not on the 150ms scheduler.
    page.evaluate("document.querySelector('video').currentTime=1;document.querySelector('.ytp-caption-segment').textContent='First caption'")
    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert page.locator('#chilltong-subtitles .line span').inner_text()=='中文：First caption'
    # Silence must not stop prefetching: warm a future cue beyond the old 16-cue range.
    page.locator('.ytp-caption-segment').evaluate("e=>e.textContent=''")
    page.wait_for_timeout(1000)
    page.evaluate("document.querySelector('video').currentTime=40;document.querySelector('.ytp-caption-segment').textContent='Future 30'")
    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert page.locator('#chilltong-subtitles .line span').inner_text()=='中文：Future 30'
    page.evaluate("document.querySelector('video').currentTime=6;document.querySelector('.ytp-caption-segment').textContent='Second caption'")
    # Native CC and the new player shortcut share state; no settings tab opens.
    tab_count=len(context.pages)
    page.locator('.ytp-subtitles-button').click()
    page.wait_for_timeout(400)
    assert page.locator('#chilltong-subtitles').is_hidden()
    before=worker.evaluate('globalThis.calls')
    page.wait_for_timeout(450)
    assert worker.evaluate('globalThis.calls')==before
    page.get_by_role('button',name='开启双语字幕（CC）',exact=True).click()
    page.get_by_text('中文：Second caption',exact=True).wait_for()
    assert page.locator('.ytp-subtitles-button').get_attribute('aria-pressed')=='true'
    assert len(context.pages)==tab_count
    assert page.locator('.chilltong-translate-button').count()==1
    # Navigation discards timeline and translation from the old video.
    page.evaluate("history.pushState({},'', '/watch?v=next');document.querySelector('.ytp-caption-segment').textContent=''")
    page.wait_for_timeout(500)
    assert page.locator('#chilltong-subtitles .line span').inner_text()==''
    # Disable from popup/settings propagates to existing YouTube tabs.
    options.get_by_label('开启中文翻译').uncheck();options.get_by_role('button',name='保存设置').click()
    page.wait_for_timeout(500)
    assert page.locator('#chilltong-subtitles').is_hidden()
    # Turning CC back on restores translation with the saved model and key.
    page.locator('.ytp-subtitles-button').click()
    page.wait_for_timeout(250)
    page.locator('.ytp-caption-segment').evaluate("e=>e.textContent='Another caption'")
    page.locator('.ytp-subtitles-button').click()
    page.get_by_text('欢迎回到播客。',exact=True).wait_for()
    assert worker.evaluate("async()=>{const s=await chrome.storage.local.get(['model','enabled','apiKey']);return s.model==='test-model' && s.enabled && !!s.apiKey}")
    assert len(context.pages)==tab_count
    # Persistent transcript accumulates translations and supports explicit speaker labels.
    with context.expect_page() as opened:
        page.get_by_role('button',name='打开双语文字稿',exact=True).click()
    review=opened.value
    review.get_by_role('heading',name='把听过的，留下来。').wait_for()
    review.locator('article').first.wait_for()
    assert review.locator('article .en').first.inner_text()=='Another caption'
    review.locator('article select').first.select_option(label='说话人 1')
    review.get_by_text('人物标注已保存',exact=True).wait_for()
    review.reload()
    review.locator('article').first.wait_for()
    assert review.locator('article select').first.input_value()=='说话人 1'
    review.locator('#episodes').select_option('fixture')
    review.get_by_text('First caption',exact=True).wait_for()
    count=review.locator('article').count()
    assert count>=30
    assert review.locator('article select').first.input_value()==''
    review.locator('article select').first.select_option(label='说话人 2')
    review.get_by_text('人物标注已保存',exact=True).wait_for()
    review.evaluate("""() => {chrome.runtime.connectNative=()=>{
      const listeners=[];return {onMessage:{addListener:f=>listeners.push(f)},onDisconnect:{addListener:()=>{}},disconnect:()=>{},postMessage:m=>{
        const result=m.action==='start'?{type:'ready'}:m.action==='chunk'?{type:'ack',seq:m.seq}:{type:'result',speakerCount:2,duration:60,engine:'test audio',transcriptionMetadata:{skill:'ai-jian-koubo',model:'small.en',language:'en'},turns:[{start:0,end:4,speaker:1},{start:4,end:60,speaker:2}]};
        queueMicrotask(()=>{if(m.action==='finish'){listeners.forEach(f=>f({type:'words',items:[{text:'hello',start:0,end:1,isGap:false}]}));listeners.forEach(f=>f({type:'segments',items:[{text:'hello',start:0,end:1,words:[{word:'hello',start:0,end:1}]}]}));}listeners.forEach(f=>f(result));});
      }};
    };} """)
    review.locator('#speaker-audio').set_input_files({'name':'fixture.wav','mimeType':'audio/wav','buffer':b'fake audio for transport test'})
    review.get_by_role('button',name='自动识别并标注',exact=True).click()
    review.get_by_text('完成：检测到 2 位说话人。',exact=False).wait_for()
    assert review.locator('article select').first.input_value()=='说话人 2'
    assert review.locator('article select').nth(2).input_value()=='自动说话人 2'
    review.reload();review.locator('article').first.wait_for()
    assert review.locator('article select').nth(2).input_value()=='自动说话人 2'
    assert review.locator('#audio-transcript').is_visible()
    assert 'hello' in review.locator('#audio-text').text_content()
    review.screenshot(path=str(ROOT/'test-artifacts/transcript.png'),full_page=False)
    with context.expect_page() as opened:
        review.get_by_role('button',name='确认人物与发布 Blog',exact=True).click()
    workflow=opened.value
    workflow.on("pageerror",lambda e:print("WORKFLOW ERROR",e,flush=True))
    workflow.get_by_role('heading',name='确认每个人，整理每句话。').wait_for()
    workflow.locator('.review-row').first.wait_for()
    assert workflow.locator('#publish').is_disabled()
    workflow.locator('#title').fill('双人播客测试稿')
    workflow.locator('#reviewed').check()
    workflow.locator('#preview').click()
    workflow.wait_for_timeout(500)
    print('workflow status:',workflow.locator('#status').inner_text(),flush=True)
    workflow.get_by_text('还有未确认人物的片段，请先标注、拆分或排除。',exact=True).wait_for()
    workflow.locator('.review-row').nth(1).get_by_role('button',name='拆成两段').click()
    workflow.locator('#split-time').fill('2')
    for i in range(2):
        workflow.locator('#split-speaker-'+str(i)).select_option('说话人 2' if i==0 else '自动说话人 2')
        workflow.locator('#split-en-'+str(i)).fill('Reviewed part '+str(i))
        workflow.locator('#split-zh-'+str(i)).fill('已校对片段 '+str(i))
    workflow.locator('#save-split').click()
    workflow.locator('#split').wait_for(state='hidden')
    for i in range(workflow.locator('.identity').count()):
        card=workflow.locator('.identity').nth(i)
        card.locator('[data-field="name"]').fill('测试人物 '+str(i+1))
        card.locator('[data-field="confirmed"]').check()
    workflow.locator('#title').fill('双人播客测试稿')
    workflow.locator('#reviewed').check()
    workflow.locator('#preview').click()
    workflow.wait_for_timeout(500)
    print('prepared status:',workflow.locator('#status').inner_text(),flush=True)
    workflow.get_by_text('预览已生成，尚未上传。确认下方效果后点击发布。',exact=True).wait_for()
    assert workflow.locator('#publish').is_enabled()
    workflow.locator('#preview-frame').screenshot(path=str(ROOT/'test-artifacts/blog-preview.png'))
    workflow.evaluate('window.scrollTo(0,0)')
    workflow.screenshot(path=str(ROOT/'test-artifacts/speaker-review.png'))
    workflow.locator('#title').fill('Edited after preview')
    assert workflow.locator('#publish').is_disabled()
    workflow.locator('#reviewed').check()
    workflow.locator('#preview').click()
    workflow.wait_for_timeout(500)
    print('prepared status:',workflow.locator('#status').inner_text(),flush=True)
    workflow.get_by_text('预览已生成，尚未上传。确认下方效果后点击发布。',exact=True).wait_for()
    worker.evaluate("() => {chrome.runtime.sendNativeMessage=async(name,m)=>{globalThis.lastPublication=m;return {ok:true,url:'https://example.com/blog/posts/test-only/',backup:'test-only',changedFiles:6};};}")
    workflow.locator('#publish').click()
    workflow.get_by_text('发布成功。',exact=True).wait_for()
    assert worker.evaluate("globalThis.lastPublication.snapshot.title==='Edited after preview'")
    workflow.close()
    review.close()
    options.get_by_role('button',name='删除密钥').click()
    assert worker.evaluate("async()=>!(await chrome.storage.local.get('apiKey')).apiKey")
    context.close()
print('PASS: MV3 load, settings, API SSE, DOM subtitles, timeline batches, navigation, native CC, player shortcut, saved config, transcript persistence, speaker labels, disable, key removal')
