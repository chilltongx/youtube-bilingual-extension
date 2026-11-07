import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
CHROME=os.environ.get('CHROME_PATH')
(ROOT/'test-artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=CHROME,headless=True)
 page=browser.new_page(viewport={'width':1000,'height':600})
 page.route('https://www.youtube.com/**',lambda r:r.fulfill(content_type='text/html',body='''<html><head><meta charset="utf-8"></head><body style="margin:0;background:#181818"><div id="movie_player" style="position:relative;width:1000px;height:562px"><video autoplay muted playsinline style="position:absolute;width:100%;height:100%;object-fit:contain"></video><div class="ytp-caption-window-container"><div class="caption-window" style="position:absolute;font:28px Arial;color:white"><span class="ytp-caption-segment">Now, one of the things that's important to us</span></div></div><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="true">CC</button></div></div></body></html>'''))
 page.goto('https://www.youtube.com/watch?v=contrast')
 page.add_style_tag(path=str(ROOT/'captions.css'))
 page.evaluate('''() => {
 window.chrome={runtime:{onMessage:{addListener:()=>{}},sendMessage:async m=>m.type==='settings'?{ok:true,enabled:true,configured:true,fontMode:'match'}:m.type==='translate'?{ok:true,text:'现在，对我们来说很重要的一点'}:{ok:true}}};
 window.scene='dark';const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=562;const ctx=canvas.getContext('2d');
 function draw(){ctx.fillStyle=window.scene==='bright'?'#fff':'#17212b';ctx.fillRect(0,0,1000,562);if(window.scene==='top-bright'){ctx.fillStyle='white';ctx.fillRect(0,0,1000,350);}}
 draw();setInterval(draw,33);document.querySelector('video').srcObject=canvas.captureStream(30);
 }''')
 page.add_script_tag(path=str(ROOT/'contrast.js'));page.add_script_tag(path=str(ROOT/'content.js'))
 page.get_by_text('现在，对我们来说很重要的一点',exact=True).wait_for()
 page.wait_for_function("document.querySelector('#movie_player').dataset.ctContrast==='dark'")
 assert page.locator('.ytp-caption-segment').evaluate('e=>getComputedStyle(e).textShadow')=='none'
 page.evaluate("window.scene='bright'")
 page.wait_for_function("document.querySelector('#movie_player').dataset.ctContrast==='bright'")
 for selector in ['.ytp-caption-segment','#chilltong-subtitles .line']:
  assert page.locator(selector).evaluate('e=>getComputedStyle(e).textShadow')!='none'
 assert page.locator('#chilltong-subtitles .line span').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
 page.screenshot(path=str(ROOT/'test-artifacts/contrast-bright.png'))
 page.evaluate("window.scene='top-bright'")
 page.wait_for_function("document.querySelector('#movie_player').dataset.ctContrast==='dark'")
 assert page.locator('.ytp-caption-segment').evaluate('e=>getComputedStyle(e).textShadow')=='none'
 page.screenshot(path=str(ROOT/'test-artifacts/contrast-dark.png'))
 page.evaluate('''() => {const p=document.querySelector('#movie_player');const c=new ChillTongAdaptiveContrast();c.ctx.getImageData=()=>{throw new DOMException('Blocked','SecurityError')};c.update(p,document.querySelector('video'),[document.querySelector('.ytp-caption-segment')],true,10000); }''')
 assert page.locator('#movie_player').get_attribute('data-ct-contrast')=='unavailable'
 assert page.locator('video').get_attribute('crossorigin') is None
 browser.close()
print('PASS: bright -> text-only shadow; dark subtitle region -> no shadow; both languages transparent; security fallback does not change playback')
