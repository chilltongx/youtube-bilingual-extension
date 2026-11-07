from pathlib import Path
import subprocess,json,tempfile,importlib.util,shutil
ROOT=Path(__file__).resolve().parents[1]
def fixture():
 s={'version':1,'videoId':'fixture-podcast','title':'Review test','date':'2026-11-05','category':'linux','description':'Test only','introduction':'My notes','coverage':'Excerpt','participants':[{'label':'A','name':'Alice','role':'Host','confirmed':True}],'rows':[{'key':'1','start':0,'end':5,'en':'Hello','zh':'你好','speaker':'A'}]}
 return json.loads(subprocess.check_output([shutil.which('node'),str(ROOT/'native/render_blog.mjs')],input=json.dumps(s).encode()))
spec=importlib.util.spec_from_file_location('remote',ROOT/'native/blog_remote.py');remote=importlib.util.module_from_spec(spec);spec.loader.exec_module(remote)
def seed(root):
 values={'index.html':'HOME','blog/index.html':'<ul class="post-list"><li><h2><a href="/blog/posts/existing/">Keep me</a></h2></li></ul>','blog/linux/index.html':'<ul class="post-list"></ul>','blog/stoic/index.html':'<div class="empty-state">Empty</div>','blog/chill/index.html':'<div class="empty-state">Empty</div>','rss.xml':'<rss><channel><language>zh-CN</language><item><link>https://example.com/blog/posts/existing/</link></item></channel></rss>','sitemap.xml':'<urlset><url><loc>https://example.com/</loc></url></urlset>'}
 for name,text in values.items():p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
 return values
bundle=fixture()
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)/'site';backups=Path(tmp)/'backups';old=seed(root)
 probe=remote.commit(bundle,root,backups,dry_run=True);assert probe['ok'] and not backups.exists()
 def fetch(url):
  path=url.removeprefix('https://example.com/');path+= 'index.html' if path.endswith('/') else '';return (root/path).read_bytes()
 result=remote.commit(bundle,root,backups,fetch=fetch);assert result['ok'];assert (root/'index.html').read_text()=='HOME'
 assert 'Keep me' in (root/'blog/index.html').read_text();assert 'existing/' in (root/'rss.xml').read_text()
 second=remote.commit(bundle,root,backups,fetch=fetch);assert second['changedFiles']==0
 bundle['html']+='\n<!-- updated -->'
 before=(root/('blog/posts/'+bundle['slug']+'/index.html')).read_bytes()
 try:remote.commit(bundle,root,backups,fetch=lambda url:b'wrong');raise AssertionError('failed verification accepted')
 except ValueError:pass
 assert (root/('blog/posts/'+bundle['slug']+'/index.html')).read_bytes()==before
print('PASS: preview, preservation of old posts, idempotence, exact HTTP hash verification, rollback')
