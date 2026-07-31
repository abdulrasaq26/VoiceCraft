const fs = require('fs');
const file = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS/AETHER_FishSpeech_Colab.ipynb';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let code = data.cells[1].source.join('');

// Fix path
code = code.replace(
    'views_path = "fish_speech/tools/server/views.py"',
    'views_path = "tools/server/views.py"'
);

data.cells[1].source = code.split(/(?<=\n)/);
fs.writeFileSync(file, JSON.stringify(data, null, 1));
console.log('Fixed AETHER_FishSpeech_Colab.ipynb');
