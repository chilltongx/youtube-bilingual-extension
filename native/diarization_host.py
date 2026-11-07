#!/usr/bin/env python3
"""Local-only anonymous speaker diarization. Framed messages; no audio files written."""
import sys,struct,json,base64,subprocess,time,importlib.util
from pathlib import Path
from settings import CONFIG,caller_allowed,executable
BASE=Path(__file__).resolve().parent
LIMIT=160*1024*1024

def emit(data):
    payload=json.dumps(data,ensure_ascii=False).encode();sys.stdout.buffer.write(struct.pack('=I',len(payload))+payload);sys.stdout.buffer.flush()
def receive():
    header=sys.stdin.buffer.read(4)
    if not header:return None
    if len(header)!=4:raise ValueError('输入中断')
    size=struct.unpack('=I',header)[0]
    if size>1024*1024:raise ValueError('音频分块过大')
    raw=sys.stdin.buffer.read(size)
    if len(raw)!=size:raise ValueError('音频分块中断')
    return json.loads(raw)
def analyze(audio,count,callback,with_transcript=False):
    import numpy as np
    import sherpa_onnx
    ffmpeg=Path(executable('ffmpeg'))
    result=subprocess.run([str(ffmpeg),'-v','error','-nostdin','-i','pipe:0','-vn','-t','7201','-ac','1','-ar','16000','-f','s16le','pipe:1'],input=audio,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
    if result.returncode:raise ValueError('音频无法解码，请使用对应节目的 MP3、WAV、FLAC 或 WebM 音频。')
    samples=np.frombuffer(result.stdout,dtype='<i2').astype(np.float32)/32768.0
    duration=len(samples)/16000
    if duration<3 or duration>7200:raise ValueError('音频时长需在 3 秒到 2 小时之间。')
    config=sherpa_onnx.OfflineSpeakerDiarizationConfig(
      segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(BASE/'models/segmentation.onnx'),window_shift_ratio=0.1),num_threads=2),
      embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(BASE/'models/embedding.onnx'),num_threads=2),
      clustering=sherpa_onnx.FastClusteringConfig(num_clusters=count if count else -1,threshold=0.5),
      min_duration_on=0.3,min_duration_off=0.5)
    if not config.validate():raise ValueError('本地说话人模型尚未就绪。')
    sd=sherpa_onnx.OfflineSpeakerDiarization(config)
    last=[-1]
    def progress(done,total):
        percent=int(done/max(total,1)*100)
        if percent!=last[0]:last[0]=percent;callback(percent)
        return 0
    result=sd.process(samples,callback=progress).sort_by_start_time()
    mapping={};turns=[]
    for r in result:
        if r.speaker not in mapping:mapping[r.speaker]=len(mapping)+1
        turns.append({'start':round(r.start,3),'end':round(r.end,3),'speaker':mapping[r.speaker]})
    transcript = None
    if with_transcript:
        skill=Path(CONFIG.get('aijian_module','__not_configured__')).expanduser()
        if not skill.is_file():raise ValueError('找不到 AI剪口播 skill 的本地转录模块。')
        spec=importlib.util.spec_from_file_location('aijian_local_whisper',skill)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        models=Path.home()/'.cache/huggingface/hub/models--Systran--faster-whisper-small.en/snapshots'
        available=[p for p in models.glob('*') if (p/'model.bin').is_file()]
        if not available:raise ValueError('本机未缓存 small.en，请先运行 native/setup_diarization.py。')
        emit({'type':'progress','stage':'AI剪口播：本地逐字转录','percent':0})
        segments,metadata=module.transcribe(samples,str(sorted(available)[-1]),'en','cpu','int8',
          progress_callback=lambda done,total:emit({'type':'progress','stage':'AI剪口播：本地逐字转录','percent':min(100,int(done/max(total,1)*100))}))
        words=module.add_gaps(module.words_from_segments(segments))
        transcript={'metadata':{**metadata,'skill':'ai-jian-koubo','model':'small.en'},'segments':segments,'words':words}
    return {'transcription':transcript,'turns':turns,'duration':duration,'speakerCount':len(mapping),'engine':'sherpa-onnx 2.0.1 / pyannote segmentation 3.0 + WeSpeaker VoxCeleb ResNet34'}
def main():
    if len(sys.argv)<2 or not caller_allowed(sys.argv[1]):return
    audio=bytearray();expected=0;count=0;started=False;seq=0;with_transcript=False
    while True:
        message=receive()
        if message is None:return
        action=message.get('action')
        if action=='start' and not started:
            expected=int(message.get('size',0));count=int(message.get('speakers',0))
            if expected<1 or expected>LIMIT or not 0<=count<=12:raise ValueError('音频最多 160 MB，人数需为自动或 1～12 人。')
            with_transcript=message.get('transcribe') is True
            started=True;emit({'type':'ready'})
        elif action=='chunk' and started:
            if message.get('seq')!=seq:raise ValueError('音频分块顺序无效')
            audio.extend(base64.b64decode(message.get('data',''),validate=True))
            if len(audio)>expected:raise ValueError('音频大小不匹配')
            emit({'type':'ack','seq':seq});seq+=1
        elif action=='finish' and started:
            if len(audio)!=expected:raise ValueError('音频传输未完成')
            emit({'type':'progress','stage':'正在本机分析音频','percent':0})
            result=analyze(audio,count,lambda percent:emit({'type':'progress','stage':'正在区分说话人','percent':percent}),with_transcript=with_transcript)
            transcription=result.pop('transcription',None)
            if transcription:
                for i in range(0,len(transcription['words']),500):emit({'type':'words','items':transcription['words'][i:i+500]})
                for i in range(0,len(transcription['segments']),100):emit({'type':'segments','items':transcription['segments'][i:i+100]})
                result['transcriptionMetadata']=transcription['metadata']
            turns=result.pop('turns')
            for i in range(0,len(turns),500):emit({'type':'turns','turns':turns[i:i+500]})
            emit({'type':'result',**result});return
        else:raise ValueError('无效的音频识别请求')
if __name__=='__main__':
    try:main()
    except (BrokenPipeError,EOFError):pass
    except Exception as error:
        try:emit({'type':'error','error':str(error)})
        except BrokenPipeError:pass
