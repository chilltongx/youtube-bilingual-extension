#!/usr/bin/env python3
"""Install pinned local inference runtime and verified official model artifacts."""
import sys,subprocess,urllib.request,tarfile,hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
venv=BASE/'.venv';models=BASE/'models';models.mkdir(exist_ok=True)
if not (venv/'bin/python3').exists():subprocess.run([sys.executable,'-m','venv',str(venv)],check=True)
subprocess.run([str(venv/'bin/python3'),'-m','pip','install','sherpa-onnx==2.0.1','numpy==2.0.2','faster-whisper==1.2.1'],check=True)
subprocess.run([str(venv/'bin/python3'),'-c',"from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small.en', revision='d1d751a5f8271d482d14ca55d9e2deeebbae577f')"],check=True)
assets=[('segmentation.onnx','https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2','220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079'),('embedding.onnx','https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx','5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94')]
for name,url,digest in assets:
 target=models/name
 if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==digest:continue
 raw=urllib.request.urlopen(url,timeout=120).read()
 if name=='segmentation.onnx':
  import io
  with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
   member=next(m for m in archive.getmembers() if m.name.endswith('/model.onnx'));raw=archive.extractfile(member).read()
 if hashlib.sha256(raw).hexdigest()!=digest:raise SystemExit('Model checksum mismatch: '+name)
 target.write_bytes(raw)
print('Models ready. Run: python3 native/install.py YOUR_EXTENSION_ID')
