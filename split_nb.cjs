const fs = require('fs');

// --- 1. Split Fish Speech Notebook ---
const fishFile = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_FishSpeech_Colab.ipynb';
let fishData = JSON.parse(fs.readFileSync(fishFile, 'utf8'));

// Cell 1: Remove SDXL pip installs
fishData.cells[1].source = fishData.cells[1].source.filter(line => !line.includes('diffusers') && !line.includes('StableDiffusionXLPipeline'));

// Cell 3: Remove SDXL logic
let fishCell3 = fishData.cells[3].source.join('');
fishCell3 = fishCell3.replace(/print\("\\n🎨 Loading Stable Diffusion.*?print\("✅ SDXL Ready!"\)\n/s, '');
fishCell3 = fishCell3.replace(/from diffusers import StableDiffusionXLPipeline\n/, '');
fishCell3 = fishCell3.replace(/class GenerateReq.*?def generate.*?return \{"image_base64": b64\}/s, '');
// Also remove GenerateReq definition and exception handling that was part of it
fishCell3 = fishCell3.replace(/    except Exception as e:\n        import traceback\n        return \{"error": str\(e\), "traceback": traceback\.format_exc\(\)\}\n/s, '');

// Update the print instructions
fishCell3 = fishCell3.replace(/Paste this ONE link into BOTH Settings boxes/, 'Paste this ONE link into the FISH SPEECH Settings box');

fishData.cells[3].source = fishCell3.split(/(?<=\n)/);
fs.writeFileSync(fishFile, JSON.stringify(fishData, null, 1));


// --- 2. Split SDXL Notebook ---
const sdFile = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_SDXL_Colab.ipynb';
let sdData = JSON.parse(fs.readFileSync(sdFile, 'utf8'));

// Cell 1: Keep only diffusers, torch, fastapi, ngrok
sdData.cells[1].source = [
  "# 1. Install Dependencies\n",
  "%cd /content\n",
  "!pip install -q diffusers accelerate torch fastapi uvicorn httpx pyngrok nest_asyncio\n",
  "print(\"✅ Dependencies installed!\")\n"
];

// Cell 3: Remove Fish Speech logic
let sdCell3 = sdData.cells[3].source.join('');
sdCell3 = sdCell3.replace(/print\("🐟 Starting Fish Speech.*?print\("✅ Fish Speech Ready!"\)\n            break\n    except:\n        pass\n    time\.sleep\(5\)\n/s, '');
sdCell3 = sdCell3.replace(/fish_process = subprocess\.Popen.*?\n\)/s, '');
sdCell3 = sdCell3.replace(/os\.system\("pkill -9 -f \\"tools\.api_server\\" \|\| true"\)\n/s, '');
sdCell3 = sdCell3.replace(/client = httpx\.AsyncClient\(base_url="http:\/\/127\.0\.0\.1:8081", timeout=None\)\n/, '');
sdCell3 = sdCell3.replace(/@app\.api_route\("\/v1\/\{path:path\}".*?return StreamingResponse\(res\.aiter_raw\(\), status_code=res\.status_code, headers=res\.headers\)\n/s, '');
// Update the print instructions
sdCell3 = sdCell3.replace(/Paste this ONE link into BOTH Settings boxes/, 'Paste this ONE link into the STABLE DIFFUSION Settings box');

// For SDXL, we don't need CPU offload if it has the whole GPU!
sdCell3 = sdCell3.replace(/pipe\.enable_model_cpu_offload\(\) # CRITICAL for sharing VRAM with Fish Speech\n/, '');

sdData.cells[3].source = sdCell3.split(/(?<=\n)/);
fs.writeFileSync(sdFile, JSON.stringify(sdData, null, 1));

console.log("Notebooks successfully split!");
