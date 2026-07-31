const fs = require('fs');
const file = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_SDXL_Colab.ipynb';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let code = data.cells[3].source.join('');

// Re-add model move to GPU
code = code.replace(
    'variant="fp16",\n)',
    'variant="fp16",\n)\npipe.to("cuda")\n'
);

data.cells[3].source = code.split(/(?<=\n)/);
fs.writeFileSync(file, JSON.stringify(data, null, 1));
console.log('Fixed AETHER_SDXL_Colab.ipynb');
