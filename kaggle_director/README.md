# AETHER Qwen Brain (Kaggle)

Runs **Qwen3.8-27B** under llama.cpp and exposes it to AETHER over an
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

## Which model, and why llama.cpp

The model is **Qwen3.8-27B** as a GGUF quantization from
`unsloth/Qwen3.8-27B-GGUF`.

Kaggle's GPUs are Turing (T4, compute capability 7.5). The obvious 4-bit build
of this model, `cyankiwi/Qwen3.8-27B-AWQ-INT4`, is **not AWQ** despite the name
— its `quantization_config.quant_method` is `compressed-tensors`, which decodes
through Marlin kernels that require compute capability 8.0. Under vLLM it
cannot load on a T4 at any setting.

llama.cpp is a different stack: its CUDA kernels run on Turing, and GGUF is an
unrelated quantization format. So the model that vLLM cannot serve here runs
fine under llama.cpp.

Two consequences of that choice, both worth knowing before you tune anything:

* llama.cpp splits a model across GPUs **by layer, not tensor-parallel**. The
  second T4 buys capacity, not speed — the cards take turns.
* The model lives **in the process that loaded it** and is not thread-safe.
  Requests are serialized behind a lock rather than batched, and the notebook
  runs uvicorn in a background thread rather than as a subprocess — a
  subprocess would load a second 20 GB copy and OOM immediately.

### Quantizations

| Quant | Size | Kaggle 2x T4 (~30 GB) | Colab 1x T4 (~15 GB) |
| :-- | --: | :-- | :-- |
| Q3_K_M | 13.8 GB | lots of headroom | just fits |
| Q4_K_M | 17.1 GB | comfortable | spills to CPU |
| Q5_K_M | 19.8 GB | **default** | spills badly |
| Q8_0 | 29.0 GB | no room for the KV cache | no |

Q5_K_M is less tight than the numbers suggest. This is a hybrid model: only
about a quarter of its 64 layers use full attention and the rest are
linear-attention layers with a fixed-size state, so the KV cache costs roughly
32 KB per token rather than 128 KB. A 16k context is about half a gigabyte,
which is why `N_CTX` defaults to 16384 rather than 4096.

Change `QUANT` in the Stage 3 config cell to move up or down the table.

## Structured output

`/director` constrains generation with a GBNF grammar compiled from
`schema.py`, so the model cannot emit a token that leaves the shape — including
the `<think>` block Qwen would otherwise open with.

`get_json_schema(inline=True)` prepares that grammar copy: it resolves `$defs`
into the tree, which llama.cpp's compiler needs, and strips validator-only
annotations (`description`, `default`, `minimum`) that it compiles
inconsistently or ignores. The full-strength schema is still applied as a
Pydantic validation pass on the result, so nothing is lost — the bounds are
just enforced after generation rather than during it.

Because llama.cpp never shows the schema to the model, the field descriptions
in `schema.py` do not steer anything. Field guidance lives in
`DIRECTOR_SYSTEM_PROMPT`.
