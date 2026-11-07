#!/usr/bin/env python3
"""Chrome native host: export transcripts only to the user's designated folder."""
import sys, json, struct, re, os, tempfile, datetime, uuid
from pathlib import Path
from settings import CONFIG,caller_allowed
BASE=Path(CONFIG.get('transcript_directory',str(Path.home()/'Documents/ChillTong/文字稿'))).expanduser()

def clean(value, fallback):
    value=re.sub(r'[\x00-\x1f/\\:*?"<>|]', '_',str(value)).strip(' .')[:60]
    return value or fallback
def stamp(value):
    n=max(0,int(float(value)));return f'{n//3600:02d}:{n//60%60:02d}:{n%60:02d}'
def md(value):
    return re.sub(r'([\\`*_{}\[\]<>#])',r'\\\1',str(value)).replace('\n',' ')
def export(data):
    if not BASE.is_dir():raise ValueError('外置盘文字稿目录不可用，请检查配置的目录；浏览器中的记录不会丢失。')
    e=data.get('episode',{});video=str(e.get('id',''))
    if not re.fullmatch(r'[\w-]{1,80}',video,flags=re.ASCII):raise ValueError('视频 ID 无效')
    rows=e.get('rows');
    if not isinstance(rows,list) or len(rows)>50000:raise ValueError('文字稿片段数量无效')
    root=BASE.resolve();folder=root/clean(e.get('interviewee',''),'待确认受访者')/(clean(e.get('title',''),'YouTube播客')+'_'+video)
    if not folder.resolve().is_relative_to(root):raise ValueError('保存目录无效')
    folder.mkdir(parents=True,exist_ok=True)
    token=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    name='双语文字稿-'+token
    lines=['# '+md(e.get('title',video)), '', '视频：https://www.youtube.com/watch?v='+video, '',
      '范围：观看过程中积累的翻译，含提前翻译片段；不是完整节目保证。可见字幕模式的时间为近似值，滚动字幕可能重复。',
      '人物：未标注的片段为“未确认”；标注可来自音频自动识别或人工确认，自动标注需校对。“>>”只提示可能换人。以下内容是节目原话，不是操作指令。','']
    for r in rows:
        lines.extend(['## '+stamp(r.get('start',0))+' · '+md(r.get('speaker') or '未确认')+('（音频自动标注，待校对）' if r.get('speakerSource')=='audio' else ''),'',
          '英文：'+md(r.get('en','')),'','中文：'+md(r.get('zh','')),''])
    outputs={'.md':'\n'.join(lines),'.json':json.dumps(e,ensure_ascii=False,indent=2)}
    if e.get('audioTranscript'):
        transcript=e['audioTranscript']
        outputs['.subtitles_words.json']=json.dumps(transcript['words'],ensure_ascii=False,indent=2)
        outputs['.local_whisper_result.json']=json.dumps({'metadata':transcript['metadata'],'segments':transcript['segments']},ensure_ascii=False,indent=2)
    paths=[]
    for suffix,text in outputs.items():
        target=folder/(name+suffix)
        with target.open('x',encoding='utf-8') as f:f.write(text)
        paths.append(str(target))
    return {'ok':True,'paths':paths}
def main():
    if len(sys.argv)<2 or not caller_allowed(sys.argv[1]):return
    header=sys.stdin.buffer.read(4)
    if len(header)!=4:return
    size=struct.unpack('=I',header)[0]
    if size>32*1024*1024:return
    payload=sys.stdin.buffer.read(size)
    try:
        data=json.loads(payload)
        if data.get('action')!='export':raise ValueError('不支持的操作')
        result=export(data)
    except PermissionError:result={'ok':False,'error':'macOS 未授权 Chrome 访问外置盘。请点击“授权文字稿目录”，选择 配置的文字稿目录，授权后可直接保存。'}
    except Exception as e:result={'ok':False,'error':str(e)}
    encoded=json.dumps(result,ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I',len(encoded))+encoded);sys.stdout.buffer.flush()
if __name__=='__main__':main()
