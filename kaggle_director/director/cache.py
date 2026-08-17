import hashlib
import json
import os

CACHE_DIR = "/tmp/director_cache"

def init_cache():
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)

def get_cache_key(script: str, style: str, model_id: str, schema_version: str, reasoning_effort: str) -> str:
    payload = f"{script}_{style}_{model_id}_{schema_version}_{reasoning_effort}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def get_cached_result(cache_key: str):
    path = os.path.join(CACHE_DIR, f"{cache_key}.json")
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

def set_cached_result(cache_key: str, data: dict):
    path = os.path.join(CACHE_DIR, f"{cache_key}.json")
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)
