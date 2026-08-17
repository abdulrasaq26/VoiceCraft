import json, re, time
from openai import OpenAI
from typing import List, Dict, Any
from .schema import get_json_schema
from .prompts import DIRECTOR_SYSTEM_PROMPT

def _strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

class DirectorInference:
    def __init__(self, model_id: str, port: int = 8000):
        self.model_id = model_id
        self.client = OpenAI(
            base_url=f"http://localhost:{port}/v1",
            api_key="sk-no-key-required",
            timeout=1200,
        )

    def chat(self, messages: List[Dict[str, str]], **kwargs):
        # Prepend the system prompt if not present
        if not any(m.get("role") == "system" for m in messages):
            messages.insert(0, {"role": "system", "content": DIRECTOR_SYSTEM_PROMPT})
        
        response = self.client.chat.completions.create(
            model=self.model_id,
            messages=messages,
            **kwargs
        )
        # For streaming
        if kwargs.get('stream'):
            return response
        
        return response.choices[0].message.content or ""

    def generate_storyboard(self, script: str, style: str = "documentary", reasoning_effort: str = "low"):
        messages = [
            {"role": "system", "content": DIRECTOR_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Visual style: {style}\n\n"
                    f"Script:\n{script}\n\n"
                    "Return ONLY the JSON storyboard  no markdown, no commentary."
                ),
            },
        ]
        extra_body = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
        t0 = time.time()
        response = self.client.chat.completions.create(
            model=self.model_id,
            messages=messages,
            temperature=0.0,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "storyboard",
                    "schema": get_json_schema(),
                    "strict": True,
                },
            },
            extra_body=extra_body or None,
        )
        latency = time.time() - t0
        raw = response.choices[0].message.content or ""
        cleaned = _strip_thinking(raw)
        try:
            return json.loads(cleaned), latency
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON after {latency:.1f}s. Error: {e}. Raw[:500]: {raw[:500]}")
