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

Runs **Qwen3.8-27B** and serves it to AETHER behind three endpoints
(`/chat`, `/generate`, `/director`) over an ngrok tunnel.

**Before you run anything:** set the accelerator to **GPU T4 x2**
(Settings → Accelerator), and add `NGROK_AUTHTOKEN` and `DIRECTOR_API_KEY`
under Add-ons → Secrets.

### Why llama.cpp and not vLLM

Kaggle's GPUs are Turing (T4, compute capability 7.5), and this model's
compressed-tensors 4-bit build — `cyankiwi/Qwen3.8-27B-AWQ-INT4`, which is not
AWQ despite the name — decodes through Marlin kernels that require sm_80. It
cannot load on a T4 under vLLM at any setting.

llama.cpp is a different stack: its CUDA kernels run on Turing, and GGUF is an
unrelated quantization format. So the model runs here as a GGUF quantization
from `unsloth/Qwen3.8-27B-GGUF`.

Two things follow from that choice:

* llama.cpp splits a model across GPUs **by layer, not tensor-parallel**. The
  second T4 buys capacity, not speed — the cards take turns.
* There is one model in one process and it is not thread-safe, so requests are
  serialized behind a lock rather than batched.
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

for i in range(GPU_COUNT):
    p = torch.cuda.get_device_properties(i)
    print(f'  GPU {i}: {p.name}  {p.total_memory/1024**3:.1f} GB  sm_{p.major}{p.minor}')

TOTAL_VRAM = sum(torch.cuda.get_device_properties(i).total_memory
                 for i in range(GPU_COUNT)) / 1024**3

print(f'\\nCUDA {torch.version.cuda} | torch {torch.__version__}')
print(f'GPUs {GPU_COUNT} | total VRAM {TOTAL_VRAM:.1f} GB')
if GPU_COUNT < 2:
    print('\\n[WARN] One GPU only. Q5_K_M (19.8 GB) will spill to CPU and crawl.')
    print('       This is what a Colab free session looks like; Kaggle gives 2x T4.')
    print('       Drop to Q3_K_M in Stage 3 if you are staying here.')
print('\\nStage 1 PASSED')
"""
    ),
    md("## Stage 2 — Dependencies (~5 min; the CUDA wheel is 1.9 GB)"),
    code(
        """
import subprocess, sys, threading, time

# Run pip and keep talking while it works. -q with no heartbeat is why this
# cell looks hung: pulling a 1.9 GB wheel takes minutes and prints nothing,
# which is indistinguishable from a dead kernel. Anything here that can run
# longer than a few seconds says so.
def pip(*args, label=''):
    print(f'  [pip] {label or args[0]} ...', flush=True)
    started = time.time()
    done = threading.Event()

    def beat():
        while not done.wait(20):
            print(f'        still working ({int(time.time()-started)}s)', flush=True)

    threading.Thread(target=beat, daemon=True).start()
    proc = subprocess.run(
        [sys.executable, '-m', 'pip', 'install', '--no-cache-dir', '-q', *args],
        capture_output=True, text=True,
    )
    done.set()

    if proc.returncode != 0:
        print(proc.stdout[-3000:])
        print(proc.stderr[-3000:])
        raise RuntimeError(f'pip failed for {label or args[0]} (exit {proc.returncode})')
    print(f'        done in {int(time.time()-started)}s', flush=True)

# The prebuilt wheel links against libcudart.so.12, so the matching CUDA
# runtime packages have to be present or importing llama_cpp dies with
# "libcudart.so.12: cannot open shared object file" — even though the GPU is
# fine and nvidia-smi works.
pip('nvidia-cuda-runtime-cu12', 'nvidia-cublas-cu12', label='CUDA runtime')

# --no-deps matters more than it looks. A plain --force-reinstall drags every
# dependency with it, which on this image means swapping numpy out from under
# a kernel that already imported torch in Stage 1 — and that kills the kernel
# later, at a random cell, with no error pointing back here.
pip('--force-reinstall', '--no-deps', 'llama-cpp-python',
    '--extra-index-url', 'https://abetlen.github.io/llama-cpp-python/whl/cu124',
    label='llama-cpp-python CUDA wheel (1.9 GB — the slow one, 3-8 min)')

# Its actual dependencies, installed normally so anything already satisfied is
# left alone.
pip('diskcache', 'jinja2', 'typing-extensions',
    'fastapi', 'uvicorn[standard]', 'pyngrok', 'huggingface_hub', 'pydantic',
    label='supporting packages')

import importlib.metadata as md
for pkg in ('llama-cpp-python', 'fastapi', 'pydantic', 'huggingface_hub', 'numpy'):
    try:
        print(f'  {pkg:22} {md.version(pkg)}')
    except Exception:
        print(f'  {pkg:22} (not installed)')
print('\\nStage 2 PASSED')
"""
    ),
    md("## Stage 3 — Configuration"),
    code(
        """
import os

# Sizes are the download, and roughly the VRAM the weights occupy.
#
#   quant      size     2x T4 (30 GB)              1x T4 (15 GB)
#   Q3_K_M     13.8 GB  lots of headroom           just fits
#   Q4_K_M     17.1 GB  comfortable                spills to CPU
#   Q5_K_M     19.8 GB  fits  <- default           spills badly
#   Q8_0       29.0 GB  no room for the KV cache   no
MODEL_REPO = 'unsloth/Qwen3.8-27B-GGUF'
QUANT      = 'Q5_K_M'
MODEL_FILE = f'Qwen3.8-27B-{QUANT}.gguf'
MODEL_DIR  = '/tmp/qwen38'

# This model is hybrid: only about a quarter of its 64 layers use full
# attention, and the rest are linear-attention layers with a fixed-size state.
# So the KV cache costs roughly 32 KB per token rather than 128 KB, and 16k of
# context is about half a gigabyte. Raising this is cheaper than it looks.
N_CTX    = 16384
API_PORT = 8001

try:
    from kaggle_secrets import UserSecretsClient
    _s = UserSecretsClient()
    NGROK_AUTHTOKEN  = _s.get_secret('NGROK_AUTHTOKEN')
    DIRECTOR_API_KEY = _s.get_secret('DIRECTOR_API_KEY')
except Exception:
    NGROK_AUTHTOKEN  = os.environ.get('NGROK_AUTHTOKEN', '')
    DIRECTOR_API_KEY = os.environ.get('DIRECTOR_API_KEY', 'test-key-change-me')

os.environ['DIRECTOR_MODEL']   = f'{MODEL_REPO}:{QUANT}'
os.environ['DIRECTOR_API_KEY'] = DIRECTOR_API_KEY
os.environ['DIRECTOR_N_CTX']   = str(N_CTX)

print('Model   :', MODEL_REPO, QUANT)
print('Context :', f'{N_CTX:,} tokens')
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
    md(
        """
## Stage 5b — Prove llama.cpp can reach the GPU

Fail here, not after a 20 GB download. This is the cell that catches the
`libcudart.so.12` import error and, more quietly, a CPU-only wheel — which
installs and imports perfectly and then runs the model at about one token per
second with no warning that anything is wrong.
"""
    ),
    code(
        """
import sys

sys.path.insert(0, '.')
from director.inference import preload_cuda_libraries   # noqa: E402

loaded = preload_cuda_libraries()
print('preloaded CUDA libraries:')
for lib in loaded:
    print('   ', lib)
if not loaded:
    print('    (none needed — already on the loader path)')

try:
    import llama_cpp
except Exception as exc:
    raise RuntimeError(
        f'llama_cpp will not import: {exc}\\n'
        'The CUDA runtime is missing or the wheel does not match it. '
        'Re-run Stage 2, and check the wheel index matches this image\\'s CUDA.'
    ) from exc

print(f'\\nllama_cpp {llama_cpp.__version__}')

# supports_gpu_offload() is the honest test. A CPU-only build imports fine and
# silently ignores n_gpu_layers, so without this you find out from the token
# rate an hour later.
gpu_ok = False
try:
    gpu_ok = bool(llama_cpp.llama_supports_gpu_offload())
except Exception as exc:
    print('could not query GPU offload support:', exc)

print('GPU offload supported:', gpu_ok)
if not gpu_ok:
    raise RuntimeError(
        'This llama-cpp-python build cannot offload to the GPU — it is a '
        'CPU-only wheel. A 27B model will be unusably slow. Reinstall from '
        'the cu124 index in Stage 2.'
    )
print('\\nStage 5b PASSED')
"""
    ),
    md("## Stage 6 — Download the GGUF (~20 GB, once per session)"),
    code(
        """
import os, shutil, threading, time
from huggingface_hub import hf_hub_download

EXPECTED_GB = {'Q3_K_M': 13.8, 'Q4_K_M': 17.1, 'Q5_K_M': 19.8, 'Q8_0': 29.0}.get(QUANT, 20.0)

os.makedirs(MODEL_DIR, exist_ok=True)
free_gb = shutil.disk_usage(MODEL_DIR).free / 1024**3
print(f'Free on {MODEL_DIR}: {free_gb:.1f} GB   |   need ~{EXPECTED_GB:.1f} GB')
if free_gb < EXPECTED_GB * 1.15:
    raise RuntimeError(
        f'Not enough disk: {free_gb:.1f} GB free, {QUANT} needs about '
        f'{EXPECTED_GB:.1f} GB. Drop to a smaller quant in Stage 3.'
    )

# Downloading straight into local_dir avoids the older two-step behaviour that
# also filled the HF cache — which is the same 20 GB again, on a disk that
# does not have it.
os.environ.setdefault('HF_HUB_ENABLE_HF_TRANSFER', '0')

t0 = time.time()
done = threading.Event()
target = os.path.join(MODEL_DIR, MODEL_FILE)

def _beat():
    # hf_hub_download's progress bar does not always survive Kaggle's output
    # handling, and twenty silent minutes looks exactly like a dead kernel.
    while not done.wait(30):
        got = 0
        for root, _dirs, files in os.walk(MODEL_DIR):
            for f in files:
                try:
                    got += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
        got_gb = got / 1024**3
        print(f'  [download] {got_gb:5.1f} / ~{EXPECTED_GB:.1f} GB   '
              f'({int(time.time()-t0)}s elapsed)', flush=True)

threading.Thread(target=_beat, daemon=True).start()
try:
    MODEL_PATH = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE, local_dir=MODEL_DIR)
finally:
    done.set()

os.environ['DIRECTOR_MODEL_PATH'] = MODEL_PATH
print(f'\\nPath : {MODEL_PATH}')
print(f'Size : {os.path.getsize(MODEL_PATH)/1024**3:.1f} GB   ({int(time.time()-t0)}s)')
print('\\nStage 6 PASSED')
"""
    ),
    md("## Stage 7 — Load the model and smoke test\n\nThe CUDA runtime is preloaded first; without it `import llama_cpp` fails with `libcudart.so.12: cannot open shared object file`."),
    code(
        """
import time
from director.inference import DirectorInference, preload_cuda_libraries

loaded = preload_cuda_libraries()
print('preloaded CUDA libs:')
for lib in loaded:
    print('  ', lib)
if not loaded:
    print('   (none needed — already on the loader path)')

import threading
print('\\nLoading 20 GB across the GPUs — 2-5 min, and llama.cpp logs as it goes.', flush=True)
t0 = time.time()
_done = threading.Event()
def _beat():
    while not _done.wait(30):
        print(f'  [loading] {int(time.time()-t0)}s elapsed...', flush=True)
threading.Thread(target=_beat, daemon=True).start()
try:
    engine = DirectorInference(model_path=MODEL_PATH, n_ctx=N_CTX, n_gpu_layers=-1, verbose=True)
finally:
    _done.set()
print(f'\\nLoaded in {time.time()-t0:.0f}s')

import torch
for i in range(torch.cuda.device_count()):
    free, total = torch.cuda.mem_get_info(i)
    print(f'  GPU {i}: {(total-free)/1024**3:.1f}/{total/1024**3:.1f} GB used')

t0 = time.time()
text = engine.chat([{'role': 'user', 'content': 'Say exactly: INFERENCE OK'}], max_tokens=64)
print(f'\\nResponse: {text!r}')
print(f'Latency : {time.time()-t0:.1f}s')
if not text.strip():
    raise RuntimeError('Empty response — the model loaded but generated nothing.')
print('\\nStage 7 PASSED')
"""
    ),
    md("## Stage 7b — Generation speed\n\nWorth knowing before you wait on a storyboard: everything downstream scales off this number."),
    code(
        """
import time

t0 = time.time()
first = None
count = 0
for delta in engine.chat(
    [{'role': 'user', 'content': 'Explain what inflation is, in about 150 words.'}],
    max_tokens=256, stream=True,
):
    if first is None:
        first = time.time()
    print(delta, end='', flush=True)
    count += 1

if first is None:
    raise RuntimeError('Stream produced nothing.')
gen = time.time() - first
print(f'\\n\\nTTFT   : {first-t0:.2f}s')
print(f'Chunks : {count}')
print(f'Speed  : {count/gen:.1f} chunks/s over {gen:.1f}s')
print('\\nA storyboard is a few thousand tokens, so budget accordingly.')
"""
    ),
    md("## Stage 8 — Structured plan against the AETHER grammar"),
    code(
        """
import json
from director.schema import VideoPlan

# `engine` is the one loaded in Stage 7. Constructing a second
# DirectorInference would load another ~20 GB copy of the weights, which is
# more VRAM than the machine has.

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
from director.schema import plan_violations

# Uses the same check the director itself runs, rather than a second copy that
# can drift from it. If this fails, the retry-and-repair path inside
# generate_plan did not save the plan — which is worth knowing loudly.
problems = plan_violations(director_plan)
scenes = director_plan.get('scenes', [])

print(f'{len(scenes)} scenes, '
      f'{len(set(s.get("visualType") for s in scenes))} distinct visual types')
for s in scenes:
    detail = ''
    if (s.get('stockRequirements') or {}).get('queries'):
        detail = ' | '.join(s['stockRequirements']['queries'][:2])
    elif (s.get('graphic') or {}).get('items'):
        detail = ', '.join(s['graphic']['items'][:3])
    elif (s.get('textOverlay') or {}).get('text'):
        detail = s['textOverlay']['text']
    print(f'  [{s.get("index")}] {s.get("visualType"):15} {detail[:60]}')

for w in director_plan.get('warnings', []):
    print('  note:', w)

if problems:
    print()
    for i, msg in problems:
        print(f'  FAIL: scene {i}: {msg}')
    raise RuntimeError(f'{len(problems)} compatibility issue(s) — AETHER could not use this plan.')
print('\\nStage 9 PASSED — plan is AETHER-compatible')
"""
    ),
    md(
        """
## Stage 10 — FastAPI + ngrok

The server runs **inside this notebook**, in a background thread, reusing the
model already in VRAM. Launching uvicorn as a subprocess the way a vLLM setup
would is not an option here: llama.cpp holds the model in the process that
loaded it, so a second process means a second 20 GB copy and an immediate OOM.

Leave this cell's kernel running for as long as you want AETHER to reach the
tunnel.
"""
    ),
    code(
        """
import threading, time
import requests
import uvicorn
import director.api as api

# Hand the API the model that is already loaded, and the settings Stage 3 chose.
api._engine   = engine
api.MODEL_PATH = MODEL_PATH
api.N_CTX      = N_CTX
api.API_KEY    = DIRECTOR_API_KEY
api.MODEL_ID   = f'{MODEL_REPO}:{QUANT}'

server = uvicorn.Server(uvicorn.Config(
    api.app, host='0.0.0.0', port=API_PORT, log_level='warning',
    # A storyboard can hold a connection for minutes; the default keep-alive
    # would drop it mid-generation.
    timeout_keep_alive=1800,
))
threading.Thread(target=server.run, daemon=True).start()

health = None
for _ in range(30):
    time.sleep(2)
    try:
        health = requests.get(f'http://localhost:{API_PORT}/health', timeout=5).json()
        break
    except Exception:
        pass
if health is None:
    raise RuntimeError('FastAPI never became healthy.')
print('health:', health)
if not health.get('loaded'):
    raise RuntimeError('API is up but has no model — engine handoff failed.')

AUTH = {'Authorization': f'Bearer {DIRECTOR_API_KEY}'}

# Auth must actually be enforced, and /health must actually be open.
assert requests.post(f'http://localhost:{API_PORT}/generate',
                     json={'prompt': 'hi'}, timeout=30).status_code in (401, 403), 'auth not enforced!'

chat = requests.post(f'http://localhost:{API_PORT}/chat', headers=AUTH,
                     json={'messages': [{'role': 'user', 'content': 'Reply with one word: ready'}],
                           'max_tokens': 512}, timeout=600)
print('/chat     ', chat.status_code, chat.json()['choices'][0]['message']['content'][:60] if chat.ok else chat.text[:200])

gen = requests.post(f'http://localhost:{API_PORT}/generate', headers=AUTH,
                    json={'prompt': 'Give one YouTube title about inflation.', 'max_tokens': 1024}, timeout=600)
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
    md("## Stage 11 — Multi-domain benchmark\n\nOptional, and slow: each plan is a few thousand grammar-constrained tokens, and llama.cpp answers one request at a time. Raise `N_DOMAINS` once Stage 7b has told you the rate."),
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
