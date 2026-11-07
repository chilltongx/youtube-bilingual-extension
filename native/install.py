#!/usr/bin/env python3
"""Register native hosts for an explicit unpacked-extension ID (macOS/Linux)."""
import json,re,sys,shlex
from pathlib import Path
base=Path(__file__).resolve().parent
if len(sys.argv)!=2 or not re.fullmatch('[a-p]{32}',sys.argv[1]):raise SystemExit('Usage: python3 native/install.py EXTENSION_ID')
identity=sys.argv[1];config=base/'config.local.json'
settings=json.loads(config.read_text()) if config.exists() else {}
settings['extension_id']=identity;config.write_text(json.dumps(settings,indent=2)+'\n');config.chmod(0o600)
if sys.platform=='darwin':directory=Path.home()/'Library/Application Support/Google/Chrome/NativeMessagingHosts'
elif sys.platform.startswith('linux'):directory=Path.home()/'.config/google-chrome/NativeMessagingHosts'
else:raise SystemExit('Automatic registration supports macOS/Linux only.')
directory.mkdir(parents=True,exist_ok=True)
for name,script in [('transcripts','transcript_host.py'),('diarization','diarization_host.py'),('blog','blog_host.py')]:
 python=base/'.venv/bin/python3' if name=='diarization' else Path(sys.executable)
 if not python.exists():continue
 launcher=base/('.launch-'+name+'.sh');launcher.write_text('#!/bin/sh\nexec '+shlex.quote(str(python))+' '+shlex.quote(str(base/script))+' "$@"\n');launcher.chmod(0o700)
 target=directory/('com.chilltong.'+name+'.json');target.write_text(json.dumps({'name':'com.chilltong.'+name,'description':'ChillTong optional '+name+' helper','path':str(launcher),'type':'stdio','allowed_origins':['chrome-extension://'+identity+'/']},indent=2)+'\n');target.chmod(0o600)
print('Native hosts registered. Blog publishing remains disabled unless explicitly configured.')
