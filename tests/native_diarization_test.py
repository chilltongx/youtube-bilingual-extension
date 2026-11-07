import subprocess,json,struct,base64,time,os
from pathlib import Path
root=Path(__file__).resolve().parents[1]
folder=Path(os.environ['DIARIZATION_TEST_DIR'])
audio=(folder/'官方两人英语示例.wav').read_bytes()
p=subprocess.Popen([str(root/'native/.venv/bin/python3'),str(root/'native/diarization_host.py'),'chrome-extension://'+os.environ['EXTENSION_ID']+'/'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def send(d):
 b=json.dumps(d).encode();p.stdin.write(struct.pack('=I',len(b))+b);p.stdin.flush()
def receive():
 h=p.stdout.read(4)
 if len(h)!=4:raise RuntimeError(p.stderr.read().decode()[-2000:])
 return json.loads(p.stdout.read(struct.unpack('=I',h)[0]))
start=time.monotonic();send({'action':'start','size':len(audio),'speakers':0,'transcribe':bool(os.environ.get('AIJIAN_TEST_TRANSCRIBE'))});assert receive()['type']=='ready'
for seq,offset in enumerate(range(0,len(audio),384*1024)):
 send({'action':'chunk','seq':seq,'data':base64.b64encode(audio[offset:offset+384*1024]).decode()});assert receive()['type']=='ack'
send({'action':'finish'});turns=[];words=[];segments=[]
while True:
 d=receive()
 if d['type']=='error':raise RuntimeError(d['error'])
 if d['type']=='progress' and d['percent']%25==0:print(d['stage'],d['percent'],flush=True)
 if d['type']=='words':words.extend(d['items'])
 if d['type']=='segments':segments.extend(d['items'])
 if d['type']=='turns':turns.extend(d['turns'])
 if d['type']=='result':d['turns']=turns;d['words']=words;d['segments']=segments;break
p.wait(timeout=10)
assert d['speakerCount']==2,d
assert len(d['turns'])>=2
if os.environ.get('AIJIAN_TEST_TRANSCRIBE'):assert words and d.get('transcriptionMetadata',{}).get('skill')=='ai-jian-koubo'
(folder/('AI剪口播复用验证.json' if words else '识别验证结果.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2))
print(json.dumps({'seconds':round(time.monotonic()-start,2),'audioSeconds':d['duration'],'speakers':d['speakerCount'],'turns':len(d['turns']),'words':len(words)}),flush=True)
