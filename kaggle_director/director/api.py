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
MODEL_ID = os.environ.get("DIRECTOR_MODEL", "Qwen/Qwen3-32B-AWQ")
VLLM_PORT = int(os.environ.get("VLLM_PORT", "8000"))
SCHEMA_VERSION = "2.0-aether"

_engine: Optional[DirectorInference] = None


def get_engine() -> DirectorInference:
    global _engine
    if _engine is None:
        _engine = DirectorInference(model_id=MODEL_ID, port=VLLM_PORT)
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
    max_tokens: int = 1024
    thinking: bool = False
    stream: bool = False


class GenerateRequest(BaseModel):
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 2048
    thinking: bool = False
    response_format: Optional[Dict[str, Any]] = None


class DirectorRequest(BaseModel):
    script: str
    title: str = "Untitled"
    style: str = "documentary"
    language: str = "en"
    cues: Optional[List[Dict[str, Any]]] = None
    brief: str = ""
    max_tokens: int = 6144
    no_cache: bool = False


# /health is deliberately unauthenticated: AETHER polls it every few seconds to
# decide whether Qwen is up, and a health probe that can fail on auth would
# report the model down whenever the key is merely misconfigured.
@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_ID, "schema_version": SCHEMA_VERSION}


@app.get("/model")
def model_info() -> dict:
    return {"model": MODEL_ID, "schema_version": SCHEMA_VERSION}


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
            stream=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Model error: {exc}") from exc

    def sse():
        try:
            for chunk in chunks:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content or ""
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
            response_format=req.response_format,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Model error: {exc}") from exc
    return {"content": text}


@app.post("/director")
def director_endpoint(req: DirectorRequest, _: str = Depends(check_token)) -> dict:
    key = get_cache_key(req.script, req.style, MODEL_ID, SCHEMA_VERSION, f"{req.cues}|{req.brief}")
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
