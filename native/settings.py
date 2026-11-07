"""Machine-local configuration. Never commit config.local.json."""
import json,os,shutil
from pathlib import Path
BASE=Path(__file__).resolve().parent
CONFIG=json.loads((BASE/'config.local.json').read_text()) if (BASE/'config.local.json').exists() else {}
def caller_allowed(origin):
    identity=CONFIG.get('extension_id','')
    return bool(identity) and origin=='chrome-extension://'+identity+'/'
def executable(name):
    value=CONFIG.get(name) or shutil.which(name)
    if not value:raise RuntimeError('Please install '+name+' and configure its path in native/config.local.json')
    return value
