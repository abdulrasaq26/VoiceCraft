const fs = require('fs');
const file = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_FishSpeech_Colab.ipynb';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let code = data.cells[1].source.join('');

// Re-add pip install for API dependencies
if (!code.includes('fastapi uvicorn')) {
    code = code.replace(
        '!pip install -q -e . torchvision\n',
        '!pip install -q -e . torchvision\n!pip install -q accelerate torch fastapi uvicorn httpx pyngrok nest_asyncio pyrootutils psutil\n'
    );
}

data.cells[1].source = code.split(/(?<=\n)/);
fs.writeFileSync(file, JSON.stringify(data, null, 1));
console.log('Fixed missing pip installs in AETHER_FishSpeech_Colab.ipynb');
