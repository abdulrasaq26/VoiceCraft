const fs = require('fs');
const file = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_All_in_One_Colab.ipynb';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const cell1 = data.cells[1];
if (cell1) {
  let code = cell1.source.join('');
  // Add expandable_segments
  if (!code.includes('expandable_segments')) {
    code = code.replace(
      'import os\n',
      'import os\nos.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"\n'
    );
  }
  
  // Add patch for views.py to empty cache
  if (!code.includes('tools/server/views.py')) {
    code += `\n
# --- APPLY VRAM LEAK FIX ---
views_path = "fish_speech/tools/server/views.py"
with open(views_path, "r") as f:
    vcode = f.read()

vcode = vcode.replace(
    "return StreamingResponse(generator(), media_type=\\"audio/wav\\")",
    "def cache_clearing_generator():\\n        for chunk in generator():\\n            yield chunk\\n        torch.cuda.empty_cache()\\n    return StreamingResponse(cache_clearing_generator(), media_type=\\"audio/wav\\")"
)
with open(views_path, "w") as f:
    f.write(vcode)
print("✅ VRAM leak patch applied to views.py!")
# ----------------------------\n`;
  }
  
  cell1.source = code.split(/(?<=\n)/);
}

const cell3 = data.cells[3];
if (cell3) {
  let code = cell3.source.join('');
  if (!code.includes('torch.cuda.empty_cache()')) {
    code = code.replace(
      'return {"image_base64": base64.b64encode(buffer.getvalue()).decode("utf-8")}',
      'b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")\n        torch.cuda.empty_cache()\n        return {"image_base64": b64}'
    );
    cell3.source = code.split(/(?<=\n)/);
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 1));
