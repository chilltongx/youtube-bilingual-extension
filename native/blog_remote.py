"""Fixed-scope remote publisher; the request cannot select server paths or commands."""
import sys,json,re,hashlib,os,shutil,uuid,time,fcntl,subprocess
from pathlib import Path
from html import escape
ROOT=Path('/srv/www/example.com')
BACKUPS=Path('/srv/backups/podcast-blog')
def digest(data):return hashlib.sha256(data).hexdigest()
def merge_listing(html,card,url,include):
    if not include and 'href="'+url+'"' not in html:return html
    match=re.search(r'<ul class="post-list">(.*?)</ul>',html,re.S)
    if match:
        items=re.findall(r'<li>.*?</li>',match.group(1),re.S)
        if re.sub(r'<li>.*?</li>','',match.group(1),flags=re.S).strip():raise ValueError('Blog 列表结构不受支持')
        items=[x for x in items if 'href="'+url+'"' not in x]
        if include:items.insert(0,card)
        items.sort(key=lambda x:(re.search(r'datetime="([\d-]+)"',x) or [None,''])[1],reverse=True)
        return html[:match.start()]+'<ul class="post-list">'+''.join(items)+'</ul>'+html[match.end():]
    if not include:return html
    html,n=re.subn(r'<div class="empty-state">.*?</div>',lambda _:'<ul class="post-list">'+card+'</ul>',html,count=1,flags=re.S)
    if n!=1:raise ValueError('找不到 Blog 列表插入位置')
    return html
def commit(bundle,root=ROOT,backups=BACKUPS,fetch=None,dry_run=False):
    slug=bundle['slug'];css_path=bundle['cssPath'];s=bundle['snapshot'];video=s['videoId'];category=s['category']
    if not re.fullmatch('podcast-[0-9a-f]{12}',slug) or not re.fullmatch(r'assets/podcast-review-[0-9a-f]{12}\.css',css_path) or category not in ['linux','stoic','chill']:raise ValueError('发布路径无效')
    if hashlib.sha256(bundle['css'].encode()).hexdigest()[:12] not in css_path:raise ValueError('样式哈希不匹配')
    article='blog/posts/'+slug+'/index.html';url='https://example.com/blog/posts/'+slug+'/';relative='/blog/posts/'+slug+'/'
    names=['index.html','blog/index.html','blog/linux/index.html','blog/stoic/index.html','blog/chill/index.html','rss.xml','sitemap.xml',article,css_path]
    before={}
    for name in names:
        p=root/name
        if p.is_symlink() or root.resolve() not in p.resolve().parents:raise ValueError('目标路径包含异常链接')
        before[name]=p.read_bytes() if p.exists() else None
    if any(before[n] is None for n in names[:7]):raise ValueError('线上 Blog 必需文件缺失')
    marker='<!-- chilltong-podcast:'+video+' -->'
    if before[article] is not None and marker.encode() not in before[article]:raise ValueError('目标文章已存在且不是该节目生成，停止覆盖')
    if before[css_path] is not None and before[css_path]!=bundle['css'].encode():raise ValueError('同名样式内容冲突')
    output={article:bundle['html'].encode(),css_path:bundle['css'].encode()}
    for name in ['blog/index.html','blog/linux/index.html','blog/stoic/index.html','blog/chill/index.html']:
        output[name]=merge_listing(before[name].decode(),bundle['card'],relative,name in ['blog/index.html','blog/'+category+'/index.html']).encode()
    rss=before['rss.xml'].decode()
    rss=re.sub(r'<item>.*?</item>',lambda m:'' if '<link>'+url+'</link>' in m.group() or '<guid>'+url+'</guid>' in m.group() else m.group(),rss,flags=re.S)
    item='<item><title>'+escape(s['title'])+'</title><link>'+url+'</link><guid>'+url+'</guid><description>'+escape(s['description'])+'</description><pubDate>'+time.strftime('%a, %d %b %Y 00:00:00 GMT',time.strptime(s['date'],'%Y-%m-%d'))+'</pubDate></item>'
    if '</language>' not in rss:raise ValueError('RSS 结构不受支持')
    output['rss.xml']=rss.replace('</language>','</language>'+item,1).encode()
    sitemap=before['sitemap.xml'].decode()
    if '<loc>'+url+'</loc>' not in sitemap:
        if '</urlset>' not in sitemap:raise ValueError('sitemap 结构不受支持')
        sitemap=sitemap.replace('</urlset>','<url><loc>'+url+'</loc></url></urlset>')
    output['sitemap.xml']=sitemap.encode()
    output={n:b for n,b in output.items() if b!=before[n]}
    if dry_run:return {'ok':True,'dryRun':True,'url':url,'changedFiles':list(output),'homepageUnchanged':True}
    backups.mkdir(parents=True,exist_ok=True)
    backup=backups/('podcast-'+time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]);backup.mkdir()
    manifest={'previous':{n:digest(before[n]) if before[n] is not None else None for n in output},'files':{n:digest(b) for n,b in output.items()},'homepage':digest(before['index.html']),'url':url}
    (backup/'manifest.json').write_text(json.dumps(manifest,indent=2))
    for n in output:
        if before[n] is not None:
            p=backup/'files'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(before[n])
    written=[]
    def atomic(p,data):
        p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+'.podcast-'+uuid.uuid4().hex);tmp.write_bytes(data);tmp.chmod(0o644);tmp.replace(p)
    try:
        for n in sorted(output,key=lambda n:0 if n.startswith('assets/') else 1 if n.startswith('blog/posts/') else 2):
            p=root/n
            if (p.read_bytes() if p.exists() else None)!=before[n]:raise ValueError('线上文件在发布期间发生变化：'+n)
            atomic(p,output[n]);written.append(n)
        if (root/'index.html').read_bytes()!=before['index.html']:raise ValueError('首页被其他发布修改，请重新预览再试')
        for n,data in output.items():
            public='https://example.com/'+(n[:-10] if n.endswith('index.html') else n)
            actual=fetch(public) if fetch else subprocess.check_output(['curl','-fsS','--max-time','20','--resolve','example.com:443:127.0.0.1','-H','Accept-Encoding: identity',public],timeout=25)
            if digest(actual)!=digest(data):raise ValueError('上线校验失败：'+n)
        state=backups/'last-publish.json';old=state.read_bytes() if state.exists() else None
        saved=json.loads(old) if old else {}
        for key in ['generated','files']:saved[key]=sorted(set(saved.get(key,[]))|set(output))
        if (state.read_bytes() if state.exists() else None)!=old:raise ValueError('发布清单并发更新')
        if old:(backup/'last-publish.json').write_bytes(old)
        atomic(state,json.dumps(saved,indent=2).encode())
    except Exception:
        for n in reversed(written):
            p=root/n
            if p.exists() and digest(p.read_bytes())==digest(output[n]):
                if before[n] is None:p.unlink()
                else:atomic(p,before[n])
        (backup/'rolled-back').write_text('Verification failed; only this release was rolled back.')
        raise
    return {'ok':True,'url':url,'backup':str(backup),'changedFiles':len(output),'health':'HTTP and SHA-256 verified; homepage unchanged','restart':'not needed'}
def main():
    request=json.load(sys.stdin)
    if request.get('dryRun'):
        print(json.dumps(commit(request['bundle'],dry_run=True),ensure_ascii=False));return
    BACKUPS.mkdir(parents=True,exist_ok=True)
    with (BACKUPS/'podcast-publish.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);print(json.dumps(commit(request['bundle']),ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));sys.exit(1)
