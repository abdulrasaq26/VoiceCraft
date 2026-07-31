const fs = require('fs');
const file = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_SDXL_Colab.ipynb';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let code = data.cells[3].source.join('');

// Add health endpoint
if (!code.includes('@app.get("/v1/health")')) {
    code = code.replace(
        'class GenerateReq(BaseModel):',
        '@app.get("/v1/health")\ndef health():\n    return {"status": "ok"}\n\n@app.get("/api/health")\ndef api_health():\n    return {"status": "ok"}\n\nclass GenerateReq(BaseModel):'
    );
}

data.cells[3].source = code.split(/(?<=\n)/);
fs.writeFileSync(file, JSON.stringify(data, null, 1));
console.log('Added health endpoint to AETHER_SDXL_Colab.ipynb');
