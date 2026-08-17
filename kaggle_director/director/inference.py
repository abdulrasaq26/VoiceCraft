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

from .prompts import (
    AETHER_SYSTEM_PROMPT,
    DIRECTOR_SYSTEM_PROMPT,
    PLANNING_SYSTEM_PROMPT,
)
from .schema import (
    NEEDS_GRAPHIC,
    NEEDS_STOCK,
    NEEDS_TEXT,
    get_json_schema,
    plan_violations,
)

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_thinking(text: str) -> str:
    """Drop the reasoning and return the answer.

    The opening <think> usually is NOT in the output. This model's chat
    template ends the prompt with a bare `<think>\\n`, so generation begins
    already inside the block and only the closing tag is ever generated. A
    regex looking for a matched pair therefore finds nothing and the caller
    gets several hundred tokens of deliberation where it expected a title.

    Everything up to the last closing tag is deliberation; what follows is the
    answer. An unclosed block means generation stopped mid-thought, and there
    is no answer in it at all — an empty string is the honest result.
    """
    text = text or ""
    if "</think>" in text:
        return text.rsplit("</think>", 1)[-1].strip()
    text = _THINK_BLOCK.sub("", text)
    if "<think>" in text:
        return text.split("<think>", 1)[0].strip()
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


def quiet_backend_logs() -> bool:
    """Silence llama.cpp's per-token logging once the model is loaded.

    The CUDA backend prints "CUDA Graph id N reused" for every decoded token.
    During the 2-5 minute load that chatter is the only sign of progress and is
    worth keeping, but a grammar-constrained plan is thousands of tokens and the
    same line thousands of times does real damage in a notebook: measured on
    Kaggle it pushed the output past 370 KB, which is enough for the editor to
    start answering "Failed to save draft", and it buries the one line that
    actually says what happened.

    Returns False if the installed llama-cpp-python does not expose the log
    hook, because a noisy notebook is a far better outcome than a stage that
    dies trying to make it quiet.
    """
    try:
        import ctypes

        import llama_cpp

        # Held on the module so the callback is not garbage collected while C
        # still holds the pointer — that crashes the kernel rather than logging.
        @ctypes.CFUNCTYPE(None, ctypes.c_int, ctypes.c_char_p, ctypes.c_void_p)
        def _swallow(level, text, user_data):  # noqa: ANN001, ARG001
            return None

        globals()["_LOG_SINK"] = _swallow
        llama_cpp.llama_log_set(_swallow, ctypes.c_void_p(0))
        return True
    except Exception:  # noqa: BLE001
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
        self._formatter = self._build_formatter()

    def _build_formatter(self):
        """A renderer for the model's own chat template that we can pass flags to.

        This model reasons by default, at the template's 'xhigh' effort, and
        the only way to turn that off is the `enable_thinking` template
        variable. create_chat_completion() does not forward unknown keywords to
        the template — it passes a fixed argument list — so the flag cannot get
        there through the normal API. Rendering the prompt ourselves and
        calling create_completion() is the way in.

        Returns None if this llama-cpp-python does not expose what we need, in
        which case everything still works through the chat API; the model just
        deliberates first and pays for it in tokens.
        """
        try:
            from llama_cpp.llama_chat_format import Jinja2ChatFormatter

            template = (self.llm.metadata or {}).get("tokenizer.chat_template")
            if not template:
                return None
            return Jinja2ChatFormatter(
                template=template,
                eos_token=self.llm._model.token_get_text(self.llm.token_eos()),
                bos_token=self.llm._model.token_get_text(self.llm.token_bos()),
                add_generation_prompt=True,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[director] chat template not renderable directly ({exc}); "
                  "reasoning cannot be disabled and replies will be slower.")
            return None

    def _render(self, messages: List[Dict[str, str]], thinking: bool,
                effort: str = "xhigh") -> Optional[str]:
        """The prompt string, with reasoning explicitly on or off."""
        if self._formatter is None:
            return None
        try:
            rendered = self._formatter(
                llama=self.llm,
                messages=messages,
                enable_thinking=thinking,
                # The template raises on anything outside its own list, so
                # never hand it a value straight from a request body.
                reasoning_effort=effort if effort in self.EFFORTS else "xhigh",
            )
            return rendered.prompt
        except Exception:
            # A template that rejects our flags is not worth failing over.
            self._formatter = None
            return None

    # -- helpers ----------------------------------------------------------

    @staticmethod
    def _with_system(messages: List[Dict[str, str]], system: str) -> List[Dict[str, str]]:
        """Return a NEW list with a system turn in front — never mutate the caller's."""
        if any(m.get("role") == "system" for m in messages):
            return list(messages)
        return [{"role": "system", "content": system}, *messages]

    #: The template validates this and raises on anything else.
    EFFORTS = ("low", "medium", "xhigh")

    # -- conversational ---------------------------------------------------

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        thinking: bool = True,
        reasoning_effort: str = "xhigh",
        stream: bool = False,
        **kwargs: Any,
    ):
        """A normal chat turn. Returns text, or a delta iterator when streaming.

        Reasoning is ON. It costs tokens — at roughly 10 tokens/second a long
        deliberation is minutes before the answer starts — but scriptwriting,
        research and fact-checking are exactly the work it pays for. Callers
        that want speed over depth pass thinking=False or a lower effort.
        """
        prepared = self._with_system(messages, AETHER_SYSTEM_PROMPT)
        prompt = self._render(prepared, thinking, reasoning_effort)

        if not stream:
            with self._lock:
                if prompt is not None:
                    result = self.llm.create_completion(
                        prompt=prompt, temperature=temperature,
                        max_tokens=max_tokens, **kwargs,
                    )
                    raw = result["choices"][0]["text"] or ""
                else:
                    result = self.llm.create_chat_completion(
                        messages=prepared, temperature=temperature,
                        max_tokens=max_tokens, **kwargs,
                    )
                    raw = result["choices"][0]["message"]["content"] or ""

            answer = strip_thinking(raw)
            if not answer and raw.strip():
                # Everything generated was deliberation that never closed, so
                # there is no answer to return. Saying so beats an empty string
                # that looks like the model had nothing to say.
                raise ValueError(
                    f"The model spent all {max_tokens} tokens reasoning and never "
                    "reached an answer. Raise max_tokens, or disable reasoning."
                )
            return answer

        return self._stream(prepared, prompt, temperature, max_tokens, kwargs)

    def _stream(self, messages, prompt, temperature, max_tokens, kwargs) -> Iterator[str]:
        """Yield content deltas, holding the model lock for the whole stream."""
        with self._lock:
            if prompt is not None:
                chunks = self.llm.create_completion(
                    prompt=prompt, temperature=temperature,
                    max_tokens=max_tokens, stream=True, **kwargs,
                )
                deltas = (c["choices"][0].get("text") or "" for c in chunks)
            else:
                chunks = self.llm.create_chat_completion(
                    messages=messages, temperature=temperature,
                    max_tokens=max_tokens, stream=True, **kwargs,
                )
                deltas = (c["choices"][0].get("delta", {}).get("content") or "" for c in chunks)

            # Generation may begin already inside a reasoning block opened by
            # the prompt, so assume we are in one until proven otherwise.
            in_thought = False
            seen_close = False
            for delta in deltas:
                if not delta:
                    continue
                if not seen_close and "</think>" in delta:
                    seen_close = True
                    in_thought = False
                    delta = delta.split("</think>", 1)[-1]
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
        max_tokens: int = 4096,
        thinking: bool = True,
        reasoning_effort: str = "xhigh",
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
            reasoning_effort=reasoning_effort,
            **kwargs,
        )

    # -- storyboard -------------------------------------------------------

    @staticmethod
    def _repair(plan: dict, cues: Optional[List[Dict[str, Any]]]) -> List[str]:
        """Last resort: make each broken beat renderable, in place.

        Only runs when the model has already been asked to fix its own work and
        did not. Rather than fail the whole storyboard over one beat, downgrade
        the beat to something the data it *did* supply can actually render —
        and where nothing was supplied, fall back to the narration itself.
        """
        narration = {}
        for position, cue in enumerate(cues or []):
            key = cue.get("index", position)
            narration[key] = str(cue.get("text") or cue.get("subtitle") or "").strip()

        notes: List[str] = []
        for position, scene in enumerate(plan.get("scenes") or []):
            # Read without a default: scene.get("index", position) would hand
            # back a perfectly valid int for a key that is not there, and the
            # check below would then decide nothing was wrong.
            index = scene.get("index")
            if not isinstance(index, int) or isinstance(index, bool):
                scene["index"] = index = position
                notes.append(f"scene {position}: supplied a missing index")

            visual = scene.get("visualType")
            line = narration.get(index, "")

            if visual in NEEDS_TEXT and not ((scene.get("textOverlay") or {}).get("text") or "").strip():
                words = line.split()
                if words:
                    scene["textOverlay"] = {
                        "text": " ".join(words[:12]),
                        "emphasis": "",
                        "style": "emphasis",
                    }
                    notes.append(f"scene {index}: captioned {visual} from its own narration")
                else:
                    scene["visualType"] = "broll"
                    notes.append(f"scene {index}: {visual} had no text and no narration, demoted to broll")

            if visual in NEEDS_GRAPHIC and not ((scene.get("graphic") or {}).get("items")):
                # A blank chart is worse than honest footage.
                scene["visualType"] = "broll"
                notes.append(f"scene {index}: {visual} had no items to draw, demoted to broll")

            if visual in NEEDS_STOCK and not ((scene.get("stockRequirements") or {}).get("queries")):
                scene["visualType"] = "broll"
                notes.append(f"scene {index}: {visual} had no queries, demoted to broll")

        if notes:
            plan.setdefault("warnings", []).extend(notes)
        return notes

    def generate_plan(
        self,
        script: str,
        style: str = "documentary",
        title: str = "Untitled",
        cues: Optional[List[Dict[str, Any]]] = None,
        brief: str = "",
        max_tokens: int = 6144,
        reasoning_effort: str = "xhigh",
        plan_tokens: int = 4096,
    ) -> Tuple[dict, float]:
        """Produce a video plan in AETHER's `parseVideoPlan` shape.

        Done in two passes, because a grammar and a reasoning block cannot
        share one call. The schema compiles to a GBNF grammar that forces the
        very first token to be an opening brace, so a model that wants to
        think first has nowhere to put the thought — a single constrained call
        gets structure at the cost of any deliberation at all.

        So the thinking happens first, unconstrained, where the model can
        weigh what each beat is about and what treatment earns its place. The
        second pass is transcription: the same decisions, now under the
        grammar. Set reasoning_effort=None to skip the first pass when speed
        matters more than the choice being any good.
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

        request = (
            f"Title: {title}\n"
            f"Visual style: {style}\n"
            + (f"\n{brief}\n" if brief else "")
            + f"\nScript:\n{script}"
            f"{beats}"
        )

        from .schema import VideoPlan

        started = time.time()
        plan: dict = {}

        # Pass one: think. Unconstrained, so the reasoning block is allowed to
        # exist at all.
        reasoning = ""
        if reasoning_effort:
            reasoning = self.chat(
                [{"role": "system", "content": PLANNING_SYSTEM_PROMPT},
                 {"role": "user", "content": request}],
                temperature=0.3,
                max_tokens=plan_tokens,
                thinking=True,
                reasoning_effort=reasoning_effort,
            )

        messages = [
            {"role": "system", "content": DIRECTOR_SYSTEM_PROMPT},
            {"role": "user", "content": request},
        ]
        if reasoning:
            # Pass two is transcription, not a second opinion. Handing the
            # decisions back as the assistant's own words is what stops it
            # re-deciding them under the grammar.
            messages += [
                {"role": "assistant", "content": reasoning},
                {"role": "user", "content":
                    "Now emit exactly that plan as JSON matching the schema. "
                    "Keep every decision you just made — same treatments, same "
                    "queries, same numbers, same wording. Change nothing."},
            ]

        # The grammar guarantees the shape but not the sense: it cannot tie a
        # visualType to the payload that type needs, so the model can pick
        # 'editorial_text' and leave textOverlay null. Showing it the specific
        # broken beats and asking again fixes this far more often than not.
        for attempt in range(self.PLAN_ATTEMPTS):
            plan = self._plan_once(messages, max_tokens, started)
            problems = plan_violations(plan)
            if not problems:
                VideoPlan(**plan)
                return plan, time.time() - started

            if attempt == self.PLAN_ATTEMPTS - 1:
                break

            listing = "\n".join(f"  - scene index {i}: {msg}" for i, msg in problems)
            messages = messages + [
                {"role": "assistant", "content": json.dumps(plan)},
                {
                    "role": "user",
                    "content": (
                        "That plan is not renderable. Every one of these beats "
                        "chose a visual type without supplying what that type "
                        "needs to draw:\n" + listing + "\n\n"
                        "Return the whole plan again with those beats fixed. "
                        "Either fill in the missing payload, or change the beat "
                        "to a visual type whose payload you actually have. "
                        "Leave every other beat as it was."
                    ),
                },
            ]

        # Still broken after asking. Repair rather than lose the storyboard —
        # one blank beat is not worth failing the other thirty.
        self._repair(plan, cues)
        VideoPlan(**plan)
        return plan, time.time() - started

    #: How many times to ask before repairing the answer ourselves.
    PLAN_ATTEMPTS = 2

    def _plan_grammar(self):
        """The compiled GBNF grammar, built once per process.

        Passing `response_format` makes llama-cpp-python compile the schema to a
        grammar on every single call, and for this schema that dominates the
        request: a one-beat plan with the reasoning pass disabled took 286s
        against roughly 30s of actual generation. Compiling once turns a
        per-request cost into a one-off, which is the difference between fitting
        inside a 300s gateway timeout and never fitting.

        Falls back to response_format if this build of llama-cpp-python does not
        expose LlamaGrammar — slow beats broken.
        """
        if getattr(self, "_grammar_cache", None) is not None:
            return self._grammar_cache
        try:
            from llama_cpp import LlamaGrammar

            self._grammar_cache = LlamaGrammar.from_json_schema(
                json.dumps(get_json_schema(inline=True)), verbose=False
            )
        except Exception:  # noqa: BLE001
            self._grammar_cache = False
        return self._grammar_cache

    def _plan_once(self, messages, max_tokens: int, started: float) -> dict:
        grammar = self._plan_grammar()
        constraint = (
            {"grammar": grammar}
            if grammar
            else {"response_format": {"type": "json_object", "schema": get_json_schema(inline=True)}}
        )
        with self._lock:
            result = self.llm.create_chat_completion(
                messages=messages,
                temperature=0.0,
                max_tokens=max_tokens,
                **constraint,
            )

        raw = result["choices"][0]["message"]["content"] or ""
        cleaned = strip_thinking(raw)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as exc:
            # The grammar should make this unreachable; hitting max_tokens
            # mid-object is the one way it happens.
            raise ValueError(
                f"Model returned invalid JSON after {time.time()-started:.1f}s ({exc}). "
                f"Finish reason: {result['choices'][0].get('finish_reason')}. "
                f"Tail: ...{cleaned[-400:]!r}"
            ) from exc

    # Older callers use this name.
    def generate_storyboard(self, script: str, style: str = "documentary", **kwargs):
        return self.generate_plan(script=script, style=style, **kwargs)
