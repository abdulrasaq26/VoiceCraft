"""FastAPI surface for AETHER.

Three ways in, one model behind them: /chat for conversation, /generate for the
structured application tasks, /director for a storyboard against the grammar.
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .cache import get_cache_key, get_cached_result, init_cache, set_cached_result
from .inference import DirectorInference

API_KEY = os.environ.get("DIRECTOR_API_KEY", "test-key-change-me")
# The notebook exports all of these before uvicorn starts. The defaults only
# matter when running the API standalone.
MODEL_ID = os.environ.get("DIRECTOR_MODEL", "unsloth/Qwen3.8-27B-GGUF:Q5_K_M")
MODEL_PATH = os.environ.get("DIRECTOR_MODEL_PATH", "")
N_CTX = int(os.environ.get("DIRECTOR_N_CTX", "16384"))
# Bumped when the schema changes shape in a way a caller can observe. 2.1 made
# sourceStrategy and preferredSources required, so a plan produced under 2.0 has
# neither and is not interchangeable.
#
# This is also part of the plan cache key, which matters more than it looks: a
# session still serving 2.0 would otherwise hand back cached plans missing the
# very fields the new schema exists to force. And /health reports it, so a
# caller can tell which generation it is actually talking to instead of assuming
# the redeploy landed.
SCHEMA_VERSION = "2.1-aether"

_engine: Optional[DirectorInference] = None


def get_engine() -> DirectorInference:
    """Load on first use.

    Loading is minutes of work and gigabytes of VRAM, so it must not happen
    during import — uvicorn would appear to hang, and /health would be
    unreachable exactly when someone is trying to find out what is wrong.
    """
    global _engine
    if _engine is None:
        if not MODEL_PATH:
            raise HTTPException(503, "DIRECTOR_MODEL_PATH is not set — no GGUF to load.")
        _engine = DirectorInference(model_path=MODEL_PATH, n_ctx=N_CTX)
    return _engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_cache()
    yield


app = FastAPI(title="AETHER Qwen Brain", lifespan=lifespan)

# The browser never reaches this directly — AETHER's node server proxies it —
# but allowing the origin makes a direct curl or a tunnel probe behave.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=True)


def check_token(creds: HTTPAuthorizationCredentials = Depends(security)) -> str:
    if creds.credentials != API_KEY:
        raise HTTPException(401, "Invalid API key")
    return creds.credentials


class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    temperature: float = 0.7
    # Generous, because on the fallback path the model reasons first and a
    # tight budget is spent entirely on deliberation, returning no answer.
    max_tokens: int = 4096
    thinking: bool = True
    reasoning_effort: str = "xhigh"
    stream: bool = False


class GenerateRequest(BaseModel):
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 4096
    thinking: bool = True
    reasoning_effort: str = "xhigh"
    response_format: Optional[Dict[str, Any]] = None


class DirectorRequest(BaseModel):
    script: str
    title: str = "Untitled"
    style: str = "documentary"
    language: str = "en"
    cues: Optional[List[Dict[str, Any]]] = None
    brief: str = ""
    max_tokens: int = 6144
    # The thinking pass. None skips it and goes straight to the grammar, which
    # is faster and noticeably less considered.
    reasoning_effort: Optional[str] = "xhigh"
    plan_tokens: int = 4096
    no_cache: bool = False


# /health is deliberately unauthenticated: AETHER polls it every few seconds to
# decide whether Qwen is up, and a health probe that can fail on auth would
# report the model down whenever the key is merely misconfigured.
@app.get("/health")
def health() -> dict:
    # `loaded` distinguishes "the server is up" from "the model is in VRAM".
    # AETHER only needs the former to stop falling back to NIM, but the
    # difference is the whole answer when a first request seems to hang.
    return {
        "status": "ok",
        "model": MODEL_ID,
        "loaded": _engine is not None,
        "schema_version": SCHEMA_VERSION,
    }


@app.get("/model")
def model_info() -> dict:
    return {
        "model": MODEL_ID,
        "path": MODEL_PATH,
        "n_ctx": N_CTX,
        "loaded": _engine is not None,
        "schema_version": SCHEMA_VERSION,
    }


@app.post("/chat")
def chat_endpoint(req: ChatRequest, _: str = Depends(check_token)):
    engine = get_engine()

    if not req.stream:
        try:
            text = engine.chat(
                req.messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                thinking=req.thinking,
                reasoning_effort=req.reasoning_effort,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"Model error: {exc}") from exc
        return {"choices": [{"message": {"role": "assistant", "content": text}}]}

    try:
        chunks = engine.chat(
            req.messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            thinking=req.thinking,
            reasoning_effort=req.reasoning_effort,
            stream=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Model error: {exc}") from exc

    def sse():
        try:
            # DirectorInference._stream yields content deltas as plain strings,
            # with any reasoning already gated out.
            for delta in chunks:
                if not delta:
                    continue
                payload = {"choices": [{"delta": {"content": delta}}]}
                yield f"data: {json.dumps(payload)}\n\n"
        except Exception as exc:  # noqa: BLE001
            # The response has already begun, so the only way to report a
            # mid-stream failure is inside the stream itself.
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/generate")
def generate_endpoint(req: GenerateRequest, _: str = Depends(check_token)) -> dict:
    try:
        text = get_engine().generate(
            req.prompt,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            thinking=req.thinking,
            reasoning_effort=req.reasoning_effort,
            response_format=req.response_format,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Model error: {exc}") from exc
    return {"content": text}


@app.post("/director")
def director_endpoint(req: DirectorRequest, _: str = Depends(check_token)) -> dict:
    key = get_cache_key(req.script, req.style, MODEL_ID, SCHEMA_VERSION, f"{req.cues}|{req.brief}|{req.reasoning_effort}")
    if not req.no_cache:
        cached = get_cached_result(key)
        if cached is not None:
            return {"success": True, "cached": True, "plan": cached, **cached}

    try:
        plan, latency = get_engine().generate_plan(
            script=req.script,
            style=req.style,
            title=req.title,
            cues=req.cues,
            brief=req.brief,
            max_tokens=req.max_tokens,
            reasoning_effort=req.reasoning_effort,
            plan_tokens=req.plan_tokens,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Director failed: {exc}") from exc

    set_cached_result(key, plan)
    # `plan` is also splatted at the top level so a caller can read `scenes`
    # straight off the response without knowing about this envelope.
    return {
        "success": True,
        "cached": False,
        "latency_sec": round(latency, 2),
        "plan": plan,
        **plan,
    }
