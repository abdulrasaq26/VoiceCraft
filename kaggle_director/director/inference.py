"""Inference through llama.cpp.

The model is Qwen3.8-27B as a GGUF quantization, loaded in-process by
llama-cpp-python rather than served by a separate vLLM process. That choice is
forced by the hardware: Kaggle's T4s are Turing (sm_75), and the
compressed-tensors 4-bit build of this model decodes through Marlin kernels
that need sm_80. llama.cpp's CUDA kernels run on Turing, and GGUF is a
different quantization format entirely.

Two consequences worth knowing:

  * llama.cpp splits a model across GPUs by layer, not by tensor. A second
    card buys capacity, not speed — the cards take turns.
  * There is one model in one process, and it is not thread-safe. Requests are
    serialized behind a lock rather than batched.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, Iterator, List, Optional, Tuple

from .prompts import AETHER_SYSTEM_PROMPT, DIRECTOR_SYSTEM_PROMPT
from .schema import get_json_schema

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_thinking(text: str) -> str:
    """Drop a Qwen reasoning block, including the truncated unclosed case."""
    text = _THINK_BLOCK.sub("", text or "")
    if "<think>" in text:
        text = text.split("</think>")[-1] if "</think>" in text else text.split("<think>")[-1]
    return text.strip()


def preload_cuda_libraries() -> List[str]:
    """Load the CUDA runtime into the process before llama.cpp asks for it.

    The prebuilt llama-cpp-python wheels link against libcudart.so.12, which is
    not on the default loader path in these images — importing llama_cpp fails
    with "libcudart.so.12: cannot open shared object file" even though CUDA is
    installed and working. Setting LD_LIBRARY_PATH from inside Python is too
    late, because the linker read it at process start.

    Opening the libraries here with RTLD_GLOBAL puts their symbols in the
    global namespace, so the later dlopen of libllama.so resolves against
    them. Call this before `import llama_cpp`.
    """
    import ctypes
    import glob
    import site

    roots: List[str] = []
    try:
        roots.extend(site.getsitepackages())
    except Exception:
        pass
    roots.append(os.path.dirname(os.path.dirname(os.__file__)))

    loaded: List[str] = []
    # Order matters: cublas depends on cublasLt, and both depend on cudart.
    for soname in ("libcudart.so.12", "libcublasLt.so.12", "libcublas.so.12"):
        if _already_loaded(soname):
            continue
        for root in roots:
            hits = glob.glob(os.path.join(root, "nvidia", "*", "lib", soname))
            hits += glob.glob(os.path.join(root, "torch", "lib", soname))
            if not hits:
                continue
            try:
                ctypes.CDLL(hits[0], mode=ctypes.RTLD_GLOBAL)
                loaded.append(hits[0])
                break
            except OSError:
                continue
    return loaded


def _already_loaded(soname: str) -> bool:
    import ctypes

    try:
        ctypes.CDLL(soname, mode=ctypes.RTLD_GLOBAL)
        return True
    except OSError:
        return False


class DirectorInference:
    """Wraps the model with the three shapes AETHER asks for: chat, generate, plan."""

    def __init__(
        self,
        model_path: str,
        n_ctx: int = 16384,
        n_gpu_layers: int = -1,
        verbose: bool = False,
        **llama_kwargs: Any,
    ):
        preload_cuda_libraries()
        from llama_cpp import Llama  # imported late so the preload runs first

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"GGUF not found at {model_path}")

        self.model_path = model_path
        self.n_ctx = n_ctx
        self.llm = Llama(
            model_path=model_path,
            n_gpu_layers=n_gpu_layers,  # -1 offloads every layer it can
            n_ctx=n_ctx,
            verbose=verbose,
            **llama_kwargs,
        )
        # One model, one process, no batching. Without this, two concurrent
        # requests interleave into the same context and corrupt each other.
        self._lock = threading.Lock()

    # -- helpers ----------------------------------------------------------

    @staticmethod
    def _with_system(messages: List[Dict[str, str]], system: str) -> List[Dict[str, str]]:
        """Return a NEW list with a system turn in front — never mutate the caller's."""
        if any(m.get("role") == "system" for m in messages):
            return list(messages)
        return [{"role": "system", "content": system}, *messages]

    @staticmethod
    def _apply_thinking(messages: List[Dict[str, str]], thinking: bool) -> List[Dict[str, str]]:
        """Qwen's soft switch for reasoning.

        llama-cpp-python renders the chat template baked into the GGUF and does
        not expose the template's own kwargs, so the switch has to travel in
        the message text. An unsupported build simply ignores the token, and
        strip_thinking() cleans up either way.
        """
        if thinking:
            return messages
        out = list(messages)
        for i in range(len(out) - 1, -1, -1):
            if out[i].get("role") == "user":
                out[i] = {**out[i], "content": f"{out[i].get('content', '')} /no_think".strip()}
                break
        return out

    # -- conversational ---------------------------------------------------

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1024,
        thinking: bool = False,
        stream: bool = False,
        **kwargs: Any,
    ):
        """A normal chat turn. Returns text, or a delta iterator when streaming."""
        prepared = self._apply_thinking(
            self._with_system(messages, AETHER_SYSTEM_PROMPT), thinking
        )

        if not stream:
            with self._lock:
                result = self.llm.create_chat_completion(
                    messages=prepared,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
            return strip_thinking(result["choices"][0]["message"]["content"] or "")

        return self._stream(prepared, temperature, max_tokens, kwargs)

    def _stream(self, messages, temperature, max_tokens, kwargs) -> Iterator[str]:
        """Yield content deltas, holding the model lock for the whole stream."""
        with self._lock:
            chunks = self.llm.create_chat_completion(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
                **kwargs,
            )
            in_thought = False
            for chunk in chunks:
                delta = chunk["choices"][0].get("delta", {}).get("content") or ""
                if not delta:
                    continue
                # Reasoning arrives token by token, so it cannot be regexed out
                # after the fact — it has to be gated as it goes past.
                if "<think>" in delta:
                    in_thought = True
                    delta = delta.split("<think>")[0]
                if in_thought:
                    if "</think>" not in delta:
                        continue
                    in_thought = False
                    delta = delta.split("</think>")[-1]
                if delta:
                    yield delta

    def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        thinking: bool = False,
        response_format: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> str:
        """One-shot completion for the structured application tasks."""
        if response_format is not None:
            kwargs["response_format"] = response_format
        return self.chat(
            [{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
            thinking=thinking,
            **kwargs,
        )

    # -- storyboard -------------------------------------------------------

    def generate_plan(
        self,
        script: str,
        style: str = "documentary",
        title: str = "Untitled",
        cues: Optional[List[Dict[str, Any]]] = None,
        brief: str = "",
        max_tokens: int = 6144,
    ) -> Tuple[dict, float]:
        """Produce a video plan in AETHER's `parseVideoPlan` shape.

        The schema is compiled to a GBNF grammar, so the model physically
        cannot emit a token that leaves the shape — including the `<think>`
        block it would otherwise open with.
        """
        beats = ""
        if cues:
            lines = []
            for position, cue in enumerate(cues):
                text = str(cue.get("text") or cue.get("subtitle") or "").strip()
                # AETHER merges the answer back onto its own scenes by index,
                # so its numbering wins whenever it sends one.
                index = cue.get("index", position)
                start = cue.get("start", cue.get("timestamp"))
                stamp = f" (t={start}s)" if start is not None else ""
                lines.append(f"  index {index}{stamp}: {text}")
            beats = (
                "\n\nBEATS — return exactly one scene for each line below, "
                "reusing these index numbers exactly:\n" + "\n".join(lines)
            )

        messages = [
            {"role": "system", "content": DIRECTOR_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Title: {title}\n"
                    f"Visual style: {style}\n"
                    + (f"\n{brief}\n" if brief else "")
                    + f"\nScript:\n{script}"
                    f"{beats}"
                ),
            },
        ]

        started = time.time()
        with self._lock:
            result = self.llm.create_chat_completion(
                messages=messages,
                temperature=0.0,
                max_tokens=max_tokens,
                response_format={
                    "type": "json_object",
                    "schema": get_json_schema(inline=True),
                },
            )
        latency = time.time() - started

        raw = result["choices"][0]["message"]["content"] or ""
        cleaned = strip_thinking(raw)
        try:
            plan = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            # The grammar should make this unreachable; hitting max_tokens
            # mid-object is the one way it happens.
            raise ValueError(
                f"Model returned invalid JSON after {latency:.1f}s ({exc}). "
                f"Finish reason: {result['choices'][0].get('finish_reason')}. "
                f"Tail: ...{cleaned[-400:]!r}"
            ) from exc

        # Validate here rather than trusting the grammar. The grammar is built
        # from a schema stripped of numeric bounds, and AETHER's parser fails
        # silently — it drops a bad scene instead of complaining — so this is
        # the last place a malformed plan can still be noticed.
        from .schema import VideoPlan

        VideoPlan(**plan)
        return plan, latency

    # Older callers use this name.
    def generate_storyboard(self, script: str, style: str = "documentary", **kwargs):
        kwargs.pop("reasoning_effort", None)  # retired
        return self.generate_plan(script=script, style=style, **kwargs)
