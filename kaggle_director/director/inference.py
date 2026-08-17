"""Thin client over the local vLLM OpenAI-compatible server."""

from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from openai import OpenAI

from .prompts import AETHER_SYSTEM_PROMPT, DIRECTOR_SYSTEM_PROMPT
from .schema import get_json_schema

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_thinking(text: str) -> str:
    """Drop a Qwen reasoning block. Also handles the unclosed, truncated case."""
    text = _THINK_BLOCK.sub("", text or "")
    # A response cut off by max_tokens mid-thought leaves a dangling <think>
    # and no content at all. Returning the raw tail is more useful than "".
    if "<think>" in text:
        text = text.split("</think>")[-1] if "</think>" in text else text.split("<think>")[-1]
    return text.strip()


class DirectorInference:
    """Wraps the model with the three shapes AETHER asks for: chat, generate, plan."""

    def __init__(self, model_id: str, port: int = 8000, timeout: float = 1800):
        self.model_id = model_id
        self.client = OpenAI(
            base_url=f"http://localhost:{port}/v1",
            api_key="sk-no-key-required",  # vLLM runs unauthenticated on localhost
            timeout=timeout,
            max_retries=0,
        )

    # -- helpers ----------------------------------------------------------

    @staticmethod
    def _with_system(messages: List[Dict[str, str]], system: str) -> List[Dict[str, str]]:
        """Return a NEW list with a system turn in front.

        Never mutate the caller's list: FastAPI hands us the parsed request
        body, and inserting into it in place would corrupt the request object
        on any retry.
        """
        if any(m.get("role") == "system" for m in messages):
            return list(messages)
        return [{"role": "system", "content": system}, *messages]

    @staticmethod
    def _thinking(enabled: bool) -> Dict[str, Any]:
        """Qwen3 toggles reasoning through the chat template, not a sampling arg."""
        return {"chat_template_kwargs": {"enable_thinking": bool(enabled)}}

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
        """A normal chat turn. Returns text, or a chunk iterator when streaming."""
        response = self.client.chat.completions.create(
            model=self.model_id,
            messages=self._with_system(messages, AETHER_SYSTEM_PROMPT),
            temperature=temperature,
            max_tokens=max_tokens,
            stream=stream,
            extra_body=self._thinking(thinking),
            **kwargs,
        )
        if stream:
            return response
        return strip_thinking(response.choices[0].message.content or "")

    def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
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

    def _plan_call(self, messages, max_tokens: int, mode: str):
        """Ask for schema-constrained JSON.

        vLLM has moved the structured-output knob twice, so rather than pin one
        spelling and break on the next release, try them oldest-supported-last
        and let the caller fall through. `mode` names which spelling to use.
        """
        schema = get_json_schema()
        common = dict(
            model=self.model_id,
            messages=messages,
            temperature=0.0,
            max_tokens=max_tokens,
        )

        if mode == "response_format":
            return self.client.chat.completions.create(
                **common,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "video_plan", "schema": schema},
                },
                extra_body=self._thinking(False),
            )
        if mode == "structured_outputs":
            return self.client.chat.completions.create(
                **common,
                extra_body={
                    "structured_outputs": {"json": schema},
                    **self._thinking(False),
                },
            )
        return self.client.chat.completions.create(
            **common,
            extra_body={"guided_json": schema, **self._thinking(False)},
        )

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

        Reasoning is forced off. The grammar makes the very first token an
        opening brace, so a model that wants to think first has nowhere to put
        the thought — enabling it makes the request fail, not deliberate.
        """
        beats = ""
        if cues:
            lines = []
            for position, cue in enumerate(cues):
                text = str(cue.get("text") or cue.get("subtitle") or "").strip()
                # AETHER merges the answer back onto its own scenes by index, so
                # its numbering wins whenever it sends one.
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

        last_error: Optional[Exception] = None
        started = time.time()
        for mode in ("response_format", "guided_json", "structured_outputs"):
            try:
                response = self._plan_call(messages, max_tokens, mode)
                break
            except Exception as exc:  # noqa: BLE001 - reported if every mode fails
                last_error = exc
        else:
            raise RuntimeError(
                f"vLLM rejected every structured-output spelling. Last error: {last_error}"
            )

        latency = time.time() - started
        raw = response.choices[0].message.content or ""
        cleaned = strip_thinking(raw)
        # The grammar should make this unreachable, but a truncated response
        # (max_tokens hit mid-object) lands here, and the raw tail is the only
        # useful thing to show.
        try:
            return json.loads(cleaned), latency
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Model returned invalid JSON after {latency:.1f}s ({exc}). "
                f"Finish reason: {response.choices[0].finish_reason}. "
                f"Tail: ...{cleaned[-400:]!r}"
            ) from exc

    # Older notebooks call this name.
    def generate_storyboard(self, script: str, style: str = "documentary", **kwargs):
        kwargs.pop("reasoning_effort", None)  # retired; reasoning is always off here
        return self.generate_plan(script=script, style=style, **kwargs)
