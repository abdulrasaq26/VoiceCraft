# AETHER Qwen Brain (Kaggle)

Serves one Qwen model behind three endpoints and exposes it to AETHER over an
ngrok tunnel.

| Endpoint | Auth | Used for |
| :-- | :-- | :-- |
| `GET /health` | none | AETHER polls this to decide Qwen is up |
| `GET /model` | none | which checkpoint is loaded |
| `POST /chat` | bearer | conversation, streaming optional |
| `POST /generate` | bearer | the structured app tasks: SEO, scripts, thumbnails |
| `POST /director` | bearer | a storyboard, constrained by the JSON grammar |

`/health` is deliberately open. AETHER decides whether to fall back to NVIDIA
NIM based on it, and a health probe that can fail on auth would report the
model down whenever the key is merely misconfigured.

## Layout

    director/          the service — this is the source of truth
      schema.py        the storyboard contract, mirroring AETHER's parser
      prompts.py       system prompts
      inference.py     the vLLM client
      api.py           FastAPI surface
      cache.py         disk cache for director results
      tests.py         contract tests, no GPU needed
    build_notebook.py  regenerates the notebook from director/
    Kaggle_Director_Qwen.ipynb   build artifact — do not hand-edit

### The notebook is generated

It writes `director/*.py` to disk at runtime, so the notebook and the package
are two copies of the same code. They drifted once already, and nothing catches
it, because the notebook overwrites whichever file disagrees with it.

So: edit `director/*.py`, then

    python build_notebook.py

and commit both. Hand-editing the `.ipynb` will be overwritten on the next
build.

## The schema is a contract with the app

`schema.py` mirrors, field for field, what `parseVideoPlan()` in
`public/prompts.js` reads. That parser has two unforgiving behaviours:

* a scene whose `index` is not a finite number is **dropped**, so an omitted
  index silently deletes the beat; and
* an unrecognised `visualType` is quietly rewritten to `stock_video` rather
  than raising.

Together those mean a schema mismatch produces an empty or wrong storyboard and
no error anywhere. `director/tests.py` asserts the two vocabularies still match:

    python -m unittest director.tests -v

Run it after touching either file. It needs only pydantic — no GPU, no model.

## Running it on Kaggle

1. Upload `Kaggle_Director_Qwen.ipynb`.
2. Settings → Accelerator → **GPU T4 x2**.
3. Add-ons → Secrets → `NGROK_AUTHTOKEN` and `DIRECTOR_API_KEY`.
4. Run all cells. Stage 10 prints the two values to put in AETHER's `.env`:

       QWEN_API_URL=https://<your-tunnel>.ngrok-free.app
       QWEN_API_KEY=<your DIRECTOR_API_KEY>

   Restart the AETHER node server afterwards. The UI status should read
   **🟢 Qwen — Primary**.

## Which model

Kaggle GPUs are Turing (T4, compute capability 7.5), and that rules out more
than it first appears:

* **bfloat16** does not exist on Turing. The notebook detects this and passes
  `--dtype float16`.
* **compressed-tensors / `pack-quantized` 4-bit** checkpoints decode through
  Marlin kernels that require compute capability 8.0. They cannot load on a T4
  at any setting.

That second point rules out `cyankiwi/Qwen3.8-27B-AWQ-INT4` despite the name —
its `quantization_config.quant_method` is `compressed-tensors`, not AWQ. It is
also a hybrid linear-attention VLM, needing newer kernels again. There is no
flag that makes it run on Kaggle.

The working options are genuine AWQ checkpoints, which vLLM has a Turing path
for. Set `MODEL_CHOICE` in the config cell:

| Model | Weights | GPUs | Notes |
| :-- | :-- | :-- | :-- |
| `Qwen/Qwen3-32B-AWQ` | ~19 GB | 2 | strongest, slowest |
| `Qwen/Qwen3-14B-AWQ` | ~9 GB | 1-2 | **default** — ~2.5x faster |
| `Qwen/Qwen3-8B-AWQ` | ~5.5 GB | 1 | fastest, weakest |

Reasoning is switched off for `/director`: the grammar forces the first token
to be `{`, so a model that wants to emit `<think>` first has nowhere to put it.
