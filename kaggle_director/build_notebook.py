#!/usr/bin/env python3
"""Regenerate Kaggle_Director_Qwen.ipynb from the director/ package.

The notebook writes director/*.py to disk at runtime, so the notebook and the
package are two copies of the same code. They drifted before — schema.py in the
notebook was two revisions behind the one in git — and nothing catches that,
because the notebook overwrites the file it disagrees with.

So the package is the source of truth and the notebook is a build artifact.
Edit director/*.py, run this, commit both.

    python build_notebook.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
NOTEBOOK = HERE / "Kaggle_Director_Qwen.ipynb"
MODULES = ["__init__.py", "schema.py", "prompts.py", "cache.py", "inference.py", "api.py", "tests.py"]


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip().splitlines(keepends=True)}


def code(text: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": text.strip().splitlines(keepends=True),
    }


def module_cell(name: str) -> dict:
    """One cell per module, embedding the file verbatim as a string literal."""
    source = (HERE / "director" / name).read_text(encoding="utf-8")
    return code(
        f"# director/{name} — generated from the package by build_notebook.py\n"
        f"SRC = {source!r}\n"
        f"Path('director/{name}').write_text(SRC, encoding='utf-8')\n"
        f"print('  wrote director/{name}', len(SRC), 'bytes')"
    )


CELLS = [
    md(
        """
# AETHER Qwen Brain — Kaggle Deployment

Serves one Qwen model behind three endpoints (`/chat`, `/generate`, `/director`)
and exposes it to AETHER over an ngrok tunnel.

**Before you run anything:** set the accelerator to **GPU T4 x2**
(Settings → Accelerator), and add `NGROK_AUTHTOKEN` and `DIRECTOR_API_KEY`
under Add-ons → Secrets.

### A note on the model

Kaggle's GPUs are Turing (T4, compute capability 7.5). That rules out two
things people reach for first:

* **bfloat16** does not exist on Turing, so the server runs in `float16`.
* **compressed-tensors / `pack-quantized` 4-bit** checkpoints — including
  `cyankiwi/Qwen3.8-27B-AWQ-INT4`, despite the name — decode through Marlin
  kernels that require compute capability 8.0. They cannot load on a T4 at any
  setting. That model is also a hybrid linear-attention VLM, which needs newer
  kernels still.

So this notebook runs a genuine **AWQ** checkpoint, which vLLM has a Turing
code path for. Pick your size in the config cell below.
"""
    ),
    md("## Stage 1 — Hardware"),
    code(
        """
import subprocess, sys, torch

print(subprocess.run(['nvidia-smi'], capture_output=True, text=True).stdout)

GPU_COUNT = torch.cuda.device_count()
if GPU_COUNT == 0:
    raise RuntimeError('No GPU. Settings -> Accelerator -> GPU T4 x2.')

caps = []
for i in range(GPU_COUNT):
    p = torch.cuda.get_device_properties(i)
    caps.append(p.major * 10 + p.minor)
    print(f'  GPU {i}: {p.name}  {p.total_memory/1024**3:.1f} GB  sm_{p.major}{p.minor}')

MIN_CAP = min(caps)
# bfloat16 needs sm_80. Everything below it has to be told to use float16, or
# vLLM aborts on the model's own torch_dtype.
DTYPE = 'bfloat16' if MIN_CAP >= 80 else 'float16'
TOTAL_VRAM = sum(torch.cuda.get_device_properties(i).total_memory for i in range(GPU_COUNT)) / 1024**3

print(f'\\nCUDA {torch.version.cuda} | torch {torch.__version__}')
print(f'GPUs {GPU_COUNT} | min sm_{MIN_CAP} | dtype -> {DTYPE} | total VRAM {TOTAL_VRAM:.1f} GB')
if GPU_COUNT < 2:
    print('\\n[WARN] Only 1 GPU. A 32B model will not fit — pick a smaller one below.')
print('\\nStage 1 PASSED')
"""
    ),
    md("## Stage 2 — Dependencies (~5-10 min)"),
    code(
        """
import subprocess, sys

# Pinned on purpose. Installing bleeding-edge transformers from git alongside
# vLLM breaks vLLM: it pins the transformers it was built against, and pip will
# happily satisfy the git URL by replacing it.
PACKAGES = [
    'vllm==0.27.1',
    'fastapi',
    'uvicorn[standard]',
    'pyngrok',
    'openai',
]

subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--no-cache-dir', '-q', *PACKAGES])

import importlib.metadata as md
for pkg in ('vllm', 'transformers', 'torch', 'pydantic'):
    try:
        print(f'  {pkg:14} {md.version(pkg)}')
    except Exception:
        print(f'  {pkg:14} (not installed)')
print('\\nStage 2 PASSED')
"""
    ),
    md("## Stage 3 — Configuration"),
    code(
        """
import os

# Every option here is a real AWQ checkpoint (quant_method 'awq'), which is the
# only 4-bit format with a Turing kernel in vLLM.
#
#   name                    weights   needs        speed on 2x T4
#   Qwen/Qwen3-32B-AWQ      ~19 GB    2 GPUs       slowest, strongest
#   Qwen/Qwen3-14B-AWQ      ~9 GB     1-2 GPUs     ~2.5x faster  <- good default
#   Qwen/Qwen3-8B-AWQ       ~5.5 GB   1 GPU        fastest, weakest
MODEL_CHOICE = 'Qwen/Qwen3-14B-AWQ'

DIRECTOR_MODEL = MODEL_CHOICE
# 8B fits on one card, so sharding it only adds communication overhead.
# Anything larger uses every GPU there is.
DIRECTOR_TP_SIZE = 1 if '8B' in MODEL_CHOICE else min(GPU_COUNT, 2)
DIRECTOR_MAX_LEN = 8192
GPU_MEM_UTIL     = 0.90
MAX_NUM_SEQS     = 4
VLLM_PORT        = 8000
API_PORT         = 8001

try:
    from kaggle_secrets import UserSecretsClient
    _s = UserSecretsClient()
    NGROK_AUTHTOKEN  = _s.get_secret('NGROK_AUTHTOKEN')
    DIRECTOR_API_KEY = _s.get_secret('DIRECTOR_API_KEY')
except Exception:
    NGROK_AUTHTOKEN  = os.environ.get('NGROK_AUTHTOKEN', '')
    DIRECTOR_API_KEY = os.environ.get('DIRECTOR_API_KEY', 'test-key-change-me')

os.environ['DIRECTOR_MODEL']   = DIRECTOR_MODEL
os.environ['DIRECTOR_API_KEY'] = DIRECTOR_API_KEY
os.environ['VLLM_PORT']        = str(VLLM_PORT)

print('Model   :', DIRECTOR_MODEL)
print('TP size :', DIRECTOR_TP_SIZE)
print('dtype   :', DTYPE)
print('Max len :', DIRECTOR_MAX_LEN)
print('API key :', (DIRECTOR_API_KEY[:4] + '****') if DIRECTOR_API_KEY else 'NOT SET')
print('Ngrok   :', 'configured' if NGROK_AUTHTOKEN else 'NOT SET (localhost only)')
"""
    ),
    md("## Stage 4 — Write the director package"),
    code(
        """
import os
from pathlib import Path
os.makedirs('director', exist_ok=True)
print('[stage 4] cwd:', os.getcwd())
"""
    ),
]

CELLS += [module_cell(name) for name in MODULES]

CELLS += [
    md("## Stage 5 — Compile and run the contract tests\n\nNo GPU needed. This is what catches the schema drifting away from AETHER's parser."),
    code(
        """
import glob, py_compile, subprocess, sys

for path in sorted(glob.glob('director/*.py')):
    py_compile.compile(path, doraise=True)
    print('  compiles:', path)

result = subprocess.run([sys.executable, '-m', 'unittest', 'director.tests', '-v'],
                        capture_output=True, text=True)
print(result.stdout[-3000:])
print(result.stderr[-3000:])
if result.returncode != 0:
    raise RuntimeError('Contract tests failed — the schema no longer matches AETHER.')
print('Stage 5 PASSED')
"""
    ),
    md("## Stage 6 — Boot vLLM\n\nFirst run downloads the weights, so allow 10-25 minutes. A heartbeat prints every 60s."),
    code(
        """
import os, subprocess, sys, threading, time
import requests, torch

env = os.environ.copy()
# FlashInfer JIT-compiles kernels that Turing cannot use; turning it off avoids
# a long build that ends in an unsupported-arch error.
env['VLLM_USE_FLASHINFER_SAMPLER'] = '0'

cmd = [
    sys.executable, '-m', 'vllm.entrypoints.openai.api_server',
    '--model',                  DIRECTOR_MODEL,
    '--tensor-parallel-size',   str(DIRECTOR_TP_SIZE),
    '--max-model-len',          str(DIRECTOR_MAX_LEN),
    '--dtype',                  DTYPE,
    '--gpu-memory-utilization', str(GPU_MEM_UTIL),
    '--max-num-seqs',           str(MAX_NUM_SEQS),
    '--enforce-eager',
    '--port',                   str(VLLM_PORT),
]
print(' '.join(cmd), '\\n')

vllm_proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, bufsize=1, env=env)

def _drain():
    for line in iter(vllm_proc.stdout.readline, ''):
        print('  [vLLM]', line, end='', flush=True)

threading.Thread(target=_drain, daemon=True).start()

DEADLINE = time.time() + 1800   # 30 min: a cold 19 GB download is not quick
started, last_beat, booted = time.time(), time.time(), False

while time.time() < DEADLINE:
    time.sleep(5)

    if vllm_proc.poll() is not None:
        raise RuntimeError(
            f'vLLM exited with code {vllm_proc.returncode} before serving. '
            'Read the [vLLM] lines above — an unsupported-quantization or '
            'out-of-memory error will be near the end.'
        )

    try:
        if requests.get(f'http://localhost:{VLLM_PORT}/health', timeout=3).status_code == 200:
            booted = True
            break
    except Exception:
        pass

    if time.time() - last_beat >= 60:
        elapsed = int(time.time() - started)
        print(f'  [heartbeat] {elapsed//60}m{elapsed%60:02d}s — still loading...', flush=True)
        last_beat = time.time()

if not booted:
    vllm_proc.terminate()
    raise RuntimeError('vLLM did not become healthy within 30 minutes.')

print(f'\\nvLLM healthy after {int(time.time()-started)}s')
for i in range(torch.cuda.device_count()):
    free, total = torch.cuda.mem_get_info(i)
    print(f'  GPU {i}: {(total-free)/1024**3:.1f}/{total/1024**3:.1f} GB used')
print('Stage 6 PASSED')
"""
    ),
    md("## Stage 7 — Smoke test"),
    code(
        """
import time
from openai import OpenAI

client = OpenAI(base_url=f'http://localhost:{VLLM_PORT}/v1', api_key='sk-no-key', timeout=600)

t0 = time.time()
resp = client.chat.completions.create(
    model=DIRECTOR_MODEL,
    messages=[{'role': 'user', 'content': 'Say exactly: INFERENCE OK'}],
    max_tokens=64,
    temperature=0.0,
    # Qwen3 opens with a <think> block unless told not to. With a small
    # max_tokens the reply would be all reasoning and no content, which reads
    # as an empty response rather than as the truncation it is.
    extra_body={'chat_template_kwargs': {'enable_thinking': False}},
)
text = (resp.choices[0].message.content or '').strip()
print(f'Response: {text!r}')
print(f'Latency : {time.time()-t0:.1f}s')
if not text:
    raise RuntimeError(f'Empty response (finish_reason={resp.choices[0].finish_reason}).')
print('Stage 7 PASSED')
"""
    ),
    md("## Stage 8 — Structured plan against the AETHER grammar"),
    code(
        """
import json
from director.inference import DirectorInference
from director.schema import VideoPlan

engine = DirectorInference(model_id=DIRECTOR_MODEL, port=VLLM_PORT)

TEST_SCRIPT = (
    'Inflation quietly reduces what your paycheck can buy over time. '
    'As prices rise, the same salary buys fewer groceries and less fuel. '
    'Food prices rose from an index of 61 in 2021 to 87 in 2024. '
    'Central banks respond by raising interest rates, which affects mortgages and spending.'
)

plan, latency = engine.generate_plan(script=TEST_SCRIPT, style='finance', title='Inflation explained')
validated = VideoPlan(**plan)

print(f'Latency : {latency:.1f}s')
print(f'Scenes  : {len(validated.scenes)}')
print(f'Strategy: {validated.strategy}\\n')
for s in validated.scenes:
    detail = ''
    if s.stockRequirements:
        detail = ' | '.join(s.stockRequirements.queries[:2])
    elif s.graphic:
        detail = ', '.join(s.graphic.items[:3])
    elif s.textOverlay:
        detail = s.textOverlay.text
    print(f'  [{s.index}] {s.visualType:15} {detail}')

director_plan = plan
print('\\nStage 8 PASSED')
"""
    ),
    md("## Stage 9 — AETHER compatibility\n\nRe-implements what `parseVideoPlan()` does, so a plan that would arrive empty in the app fails here instead."),
    code(
        """
VISUAL_TYPES = {
    'stock_video', 'stock_photo', 'stock_text', 'editorial_text',
    't2v', 'broll', 'presenter',
    'stickman', 'whiteboard', 'chart', 'map', 'timeline', 'diagram',
}
NEEDS_STOCK   = {'stock_video', 'stock_photo', 'stock_text'}
NEEDS_TEXT    = {'stock_text', 'editorial_text'}
NEEDS_GRAPHIC = {'stickman', 'whiteboard', 'chart', 'map', 'timeline', 'diagram'}

issues, warnings = [], []
scenes = director_plan.get('scenes', [])

if not scenes:
    issues.append('no scenes — AETHER would show an empty storyboard')

seen = set()
for s in scenes:
    idx = s.get('index')
    tag = f'scene[{idx}]'
    # AETHER drops any scene whose index is not a finite number.
    if not isinstance(idx, (int, float)) or isinstance(idx, bool):
        issues.append(f'{tag}: index missing or not numeric — this beat would be dropped')
    elif idx in seen:
        issues.append(f'{tag}: duplicate index')
    else:
        seen.add(idx)

    vt = s.get('visualType')
    if vt not in VISUAL_TYPES:
        issues.append(f'{tag}: unknown visualType {vt!r} — would silently become stock_video')

    queries = ((s.get('stockRequirements') or {}).get('queries')) or []
    if vt in NEEDS_STOCK and not queries:
        issues.append(f'{tag}: {vt} with no stock queries — nothing to search for')
    for q in queries:
        if len(str(q).split()) < 2:
            warnings.append(f'{tag}: one-word query {q!r} will match almost anything')

    if vt in NEEDS_TEXT and not ((s.get('textOverlay') or {}).get('text')):
        issues.append(f'{tag}: {vt} with no textOverlay.text — renders a blank card')

    if vt in NEEDS_GRAPHIC and not ((s.get('graphic') or {}).get('items')):
        issues.append(f'{tag}: {vt} with no graphic.items — renders a blank card')

print(f'{len(scenes)} scenes, {len(set(s.get("visualType") for s in scenes))} distinct visual types')
for w in warnings:
    print('  warn:', w)
if issues:
    print()
    for i in issues:
        print('  FAIL:', i)
    raise RuntimeError(f'{len(issues)} compatibility issue(s) — AETHER could not use this plan.')
print('\\nStage 9 PASSED — plan is AETHER-compatible')
"""
    ),
    md("## Stage 10 — FastAPI + ngrok"),
    code(
        """
import subprocess, sys, time
import requests

api_log = open('/tmp/api.log', 'w')
api_proc = subprocess.Popen(
    [sys.executable, '-m', 'uvicorn', 'director.api:app', '--host', '0.0.0.0', '--port', str(API_PORT)],
    stdout=api_log, stderr=subprocess.STDOUT,
)

health = None
for _ in range(30):
    time.sleep(2)
    try:
        health = requests.get(f'http://localhost:{API_PORT}/health', timeout=5).json()
        break
    except Exception:
        if api_proc.poll() is not None:
            print(open('/tmp/api.log').read()[-3000:])
            raise RuntimeError('uvicorn exited — see log above.')
if health is None:
    print(open('/tmp/api.log').read()[-3000:])
    raise RuntimeError('FastAPI never became healthy.')
print('health:', health)

AUTH = {'Authorization': f'Bearer {DIRECTOR_API_KEY}'}

# Auth must actually be enforced, and /health must actually be open.
assert requests.post(f'http://localhost:{API_PORT}/generate',
                     json={'prompt': 'hi'}, timeout=30).status_code in (401, 403), 'auth not enforced!'

chat = requests.post(f'http://localhost:{API_PORT}/chat', headers=AUTH,
                     json={'messages': [{'role': 'user', 'content': 'Reply with one word: ready'}],
                           'max_tokens': 32}, timeout=300)
print('/chat     ', chat.status_code, chat.json()['choices'][0]['message']['content'][:60] if chat.ok else chat.text[:200])

gen = requests.post(f'http://localhost:{API_PORT}/generate', headers=AUTH,
                    json={'prompt': 'Give one YouTube title about inflation.', 'max_tokens': 64}, timeout=300)
print('/generate ', gen.status_code, gen.json()['content'][:60] if gen.ok else gen.text[:200])

plan = requests.post(f'http://localhost:{API_PORT}/director', headers=AUTH,
                     json={'script': TEST_SCRIPT, 'style': 'finance'}, timeout=1800)
print('/director ', plan.status_code, f"{len(plan.json().get('scenes', []))} scenes" if plan.ok else plan.text[:200])
if not (chat.ok and gen.ok and plan.ok):
    raise RuntimeError('An endpoint failed — see the statuses above.')

PUBLIC_URL = None
if NGROK_AUTHTOKEN:
    from pyngrok import ngrok
    ngrok.set_auth_token(NGROK_AUTHTOKEN)
    PUBLIC_URL = ngrok.connect(API_PORT).public_url
    print(f'\\n  Public URL : {PUBLIC_URL}')
    print(f'  API key    : {DIRECTOR_API_KEY}')
    print('\\n  Put these in AETHER\\'s .env, then restart the node server:')
    print(f'    QWEN_API_URL={PUBLIC_URL}')
    print(f'    QWEN_API_KEY={DIRECTOR_API_KEY}')
else:
    print('\\nNGROK_AUTHTOKEN not set — reachable on localhost only.')
print('\\nStage 10 PASSED')
"""
    ),
    md("## Stage 11 — Multi-domain benchmark\n\nOptional, and slow on a T4. Raise `N_DOMAINS` once you know the timings."),
    code(
        """
import time

N_DOMAINS = 4   # of 12; each plan takes roughly 1-4 min on 2x T4

DOMAINS = [
    ('finance',      'Inflation quietly reduces what your paycheck can buy. Central banks raise rates to cool prices.'),
    ('history',      'In 1944, Allied forces launched the largest amphibious invasion in history at Normandy.'),
    ('science',      'DNA carries the instructions for life. Every cell holds the same three billion base pairs.'),
    ('technology',   'Language models are trained on billions of tokens and predict the next word from learned patterns.'),
    ('medicine',     'Sleeping fewer than six hours a night significantly raises the risk of heart disease.'),
    ('cooking',      'The secret to risotto is patience: add warm stock one ladle at a time, stirring constantly.'),
    ('education',    'The Socratic method asks students to question assumptions rather than absorb answers.'),
    ('fitness',      'Interval training burns more calories in twenty minutes than an hour of steady jogging.'),
    ('business',     'Startups focused on customer problems are far likelier to find product-market fit.'),
    ('psychology',   'Cognitive dissonance is the discomfort of holding two conflicting beliefs at once.'),
    ('geography',    'The Amazon produces a fifth of the world oxygen and hosts a tenth of all known species.'),
    ('storytelling', 'Every story is a character who wants something, obstacles, and what the struggle reveals.'),
][:N_DOMAINS]

print(f'{"domain":<14}{"status":<8}{"secs":>7}{"scenes":>8}{"types":>7}')
print('-' * 46)

rows = []
for domain, script in DOMAINS:
    try:
        plan, latency = engine.generate_plan(script=script, style=domain)
        VideoPlan(**plan)
        scenes = plan['scenes']
        kinds = len({s['visualType'] for s in scenes})
        print(f'{domain:<14}{"ok":<8}{latency:>7.1f}{len(scenes):>8}{kinds:>7}')
        rows.append(True)
    except Exception as exc:
        print(f'{domain:<14}{"FAIL":<8}  {str(exc)[:40]}')
        rows.append(False)

print(f'\\n{sum(rows)}/{len(rows)} passed')
"""
    ),
]


def build() -> dict:
    return {
        "cells": CELLS,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.11"},
            "accelerator": "GPU",
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


if __name__ == "__main__":
    NOTEBOOK.write_text(json.dumps(build(), indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {NOTEBOOK.name}: {len(CELLS)} cells")
