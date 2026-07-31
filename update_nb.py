import json

path = r'C:\Users\abdul\.gemini\antigravity\scratch\Blvck-TTS\AETHER_FishSpeech_Colab.ipynb'
with open(path, 'r', encoding='utf-8') as f:
    nb = json.load(f)

markdown_cell = {
    'cell_type': 'markdown',
    'metadata': {},
    'source': [
        '# 3. Add Custom Voices (Zero-Shot Cloning)\n',
        'Fish Speech S2 Pro allows you to instantly clone ANY voice just by providing a 10-second reference audio file!\n',
        '\n',
        '**How to clone your own voice:**\n',
        '1. In the file explorer on the left, navigate to `/content/fish-speech/references/`\n',
        '2. Create a new folder with your voice name (e.g. `My_Voice`)\n',
        '3. Upload a 10-20s clean `.wav` or `.mp3` file of the voice speaking and name it `audio.wav`\n',
        '4. Create a text file called `audio.lab` in the same folder and type out exactly what is being said in the audio.\n',
        '5. Restart the Unified API Server cell below so it detects the new folder!\n',
        '\n',
        '*(Run the cell below to automatically install a sample "JFK Presidential" voice pack to test it out!)*'
    ]
}

code_cell = {
    'cell_type': 'code',
    'execution_count': None,
    'metadata': {},
    'outputs': [],
    'source': [
        'import os\n',
        'import requests\n',
        '\n',
        'voice_id = "JFK_Presidential"\n',
        'os.makedirs(f"/content/fish-speech/references/{voice_id}", exist_ok=True)\n',
        '\n',
        'wav_path = f"/content/fish-speech/references/{voice_id}/audio.wav"\n',
        'print(f"Downloading sample audio to {wav_path}...")\n',
        '\n',
        '# Using HuggingFace\\'s ultra-reliable CDN\n',
        'url = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav"\n',
        'with open(wav_path, "wb") as f:\n',
        '    f.write(requests.get(url).content)\n',
        '\n',
        'lab_path = f"/content/fish-speech/references/{voice_id}/audio.lab"\n',
        'with open(lab_path, "w", encoding="utf-8") as f:\n',
        '    f.write("And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.")\n',
        '\n',
        'print(f"✅ Custom voice \'{voice_id}\' installed successfully!")\n'
    ]
}

nb['cells'].insert(3, markdown_cell)
nb['cells'].insert(4, code_cell)

for cell in nb['cells']:
    if cell['cell_type'] == 'code' and cell['source'] and cell['source'][0].startswith('# 3. Launch Unified API Server'):
        cell['source'][0] = '# 4. Launch Unified API Server\n'

with open(path, 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1)

print('Notebook successfully updated.')
