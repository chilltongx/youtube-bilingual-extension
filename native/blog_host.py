#!/usr/bin/env python3
import sys,json,struct,subprocess,shlex,os,uuid
from pathlib import Path
BASE=Path(__file__).resolve().parent
from settings import CONFIG,caller_allowed,executable
SITE=Path(CONFIG.get('site_root',str(Path.home()/'Sites/podcast-blog'))).expanduser()
# This is a template for the documented static-blog layout, not a hosted service.
def connection():
    if not CONFIG.get('publish_enabled'):raise ValueError('Blog publishing is disabled. Review docs/PUBLISHING.md and configure your own adapter.')
    target=CONFIG.get('ssh_target','');key=CONFIG.get('ssh_identity','')
    if not target or target.startswith('-') or any(c.isspace() for c in target):raise ValueError('Configure ssh_target first')
    args=[executable('ssh'),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15']
    if key:args+=['-i',str(Path(key).expanduser())]
    return args+[target]
def publish(request):
    SSH=connection()
    NODE=executable("node")
    if request.get('action')=='check':
        result=subprocess.run(SSH+['test -r /www/wwwroot/www.your Blog/index.html && test -r /srv/www/example.com/rss.xml'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35)
        if result.returncode:raise ValueError('发布连接失败：'+result.stderr.decode()[-400:])
        return {'ok':True,'ready':True}
    if request.get('action') not in ['publish','probe']:raise ValueError('不支持的发布操作')
    s=request['snapshot']
    rendered=subprocess.run([NODE,str(BASE/'render_blog.mjs')],input=json.dumps(s).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
    if rendered.returncode:raise ValueError(rendered.stderr.decode()[:500])
    b=json.loads(rendered.stdout)
    if b['hash']!=request.get('hash'):raise ValueError('预览快照校验失败')
    # Verify local source destinations before any remote write.
    sources={SITE/'content/posts'/(b['slug']+'.md'):b['markdown'],SITE/'templates/posts'/(b['slug']+'.html'):b['html'],SITE/'public'/b['cssPath']:b['css']}
    marker='chilltong-podcast:'+s['videoId']
    for path,text in sources.items():
        if path.is_symlink() or not path.resolve().is_relative_to(SITE.resolve()):raise ValueError('本地源文件路径无效')
        if path.exists() and path.suffix!='.css' and marker not in path.read_text():raise ValueError('本地文章源文件冲突')
    remote=(BASE/'blog_remote.py').read_text()
    result=subprocess.run(SSH+['python3 -c '+shlex.quote(remote)],input=json.dumps({'bundle':b,'dryRun':request['action']=='probe'}).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=240)
    try:response=json.loads(result.stdout)
    except Exception:raise ValueError('无法完成 SSH 发布，请检查连接；'+result.stderr.decode()[-400:])
    if not response.get('ok'):raise ValueError(response.get('error','发布失败'))
    if request['action']=='publish':
        try:
            for path,text in sources.items():
                path.parent.mkdir(parents=True,exist_ok=True)
                tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp');tmp.write_text(text);tmp.replace(path)
        except Exception as error:response['sourceWarning']='文章已上线，但本地源文件写入失败：'+str(error)
    return response
if __name__=='__main__':
    if len(sys.argv)<2 or not caller_allowed(sys.argv[1]):sys.exit(0)
    try:
        h=sys.stdin.buffer.read(4);size=struct.unpack('=I',h)[0]
        if size>16*1024*1024:raise ValueError('稿件过大，请分篇发布')
        request=json.loads(sys.stdin.buffer.read(size));response=publish(request)
    except Exception as e:response={'ok':False,'error':str(e)}
    b=json.dumps(response,ensure_ascii=False).encode();sys.stdout.buffer.write(struct.pack('=I',len(b))+b);sys.stdout.buffer.flush()
