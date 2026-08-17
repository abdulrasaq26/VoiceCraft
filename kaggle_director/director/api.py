import os, time, json
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from .inference import DirectorInference
from .cache import init_cache, get_cache_key, get_cached_result, set_cached_result

API_KEY  = os.environ.get("DIRECTOR_API_KEY",  "test-key-change-me")
MODEL_ID = os.environ.get("DIRECTOR_MODEL",    "cyankiwi/Qwen3.8-27B-AWQ-INT4")
VLLM_PORT = int(os.environ.get("VLLM_PORT",   "8000"))

app      = FastAPI(title="Qwen3.8-27B AETHER Brain API")
security = HTTPBearer()
_engine  = None

def get_engine():
    global _engine
    if _engine is None:
        _engine = DirectorInference(model_id=MODEL_ID, port=VLLM_PORT)
    return _engine

def check_token(creds: HTTPAuthorizationCredentials = Depends(security)):
    if creds.credentials != API_KEY:
        raise HTTPException(401, "Invalid API key")
    return creds.credentials

@app.on_event("startup")
async def _startup():
    init_cache()

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1024
    stream: Optional[bool] = False

class GenerateRequest(BaseModel):
    prompt: str
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1024
    response_format: Optional[Dict[str, Any]] = None

class DirectorRequest(BaseModel):
    script: str
    title: Optional[str] = "Untitled"
    style: Optional[str] = "documentary"
    language: Optional[str] = "en"
    reasoning_effort: Optional[str] = "low"

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID}

@app.get("/model")
def model_info():
    return {"model": MODEL_ID}

@app.post("/chat")
async def chat_endpoint(req: ChatRequest, _: str = Depends(check_token)):
    try:
        engine = get_engine()
        if req.stream:
            # Proxy the generator directly
            res = engine.chat(req.messages, temperature=req.temperature, max_tokens=req.max_tokens, stream=True)
            async def stream_generator():
                for chunk in res:
                    yield f"data: {{json.dumps({{'choices': [{{'delta': {{'content': chunk.choices[0].delta.content or ''}}}}]}})}}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(stream_generator(), media_type="text/event-stream")
        else:
            text = engine.chat(req.messages, temperature=req.temperature, max_tokens=req.max_tokens, stream=False)
            return {"choices": [{"message": {"content": text}}]}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/generate")
def generate_endpoint(req: GenerateRequest, _: str = Depends(check_token)):
    try:
        engine = get_engine()
        kwargs = {"temperature": req.temperature, "max_tokens": req.max_tokens, "stream": False}
        if req.response_format:
            kwargs["response_format"] = req.response_format
        text = engine.chat([{"role": "user", "content": req.prompt}], **kwargs)
        return {"content": text}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/director")
def direct(req: DirectorRequest, _: str = Depends(check_token)):
    cache_key = get_cache_key(req.script, req.style, MODEL_ID, "1.0", req.reasoning_effort)
    cached = get_cached_result(cache_key)
    if cached:
        return {"success": True, "cached": True, "storyboard": cached}
    try:
        sb, latency = get_engine().generate_storyboard(
            script=req.script,
            style=req.style,
            reasoning_effort=req.reasoning_effort,
        )
        set_cached_result(cache_key, sb)
        return {
            "success": True, "cached": False,
            "latency_sec": round(latency, 2), "storyboard": sb,
        }
    except Exception as e:
        raise HTTPException(500, str(e))
