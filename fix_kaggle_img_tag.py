import json

with open('Phase_2_Kaggle_PoC.ipynb', 'r', encoding='utf-8') as f:
    nb = json.load(f)

for cell in nb['cells']:
    if cell['cell_type'] == 'code':
        src = ''.join(cell['source'])
        if 'server.cjs' in src:
            old_code = """        ${spec.tracks.map(track => {
            if (track.type === "video" || track.type === "image") {
                return track.clips.map(clip => {
                    const file = req.files.find(f => f.fieldname === clip.source);
                    const src = file ? `./assets/${file.originalname}` : "";
                    return `<img id="${clip.id}" class="clip" src="${src}" />`;
                }).join("");"""
            
            new_code = """        ${spec.tracks.map(track => {
            if (track.type === "video" || track.type === "image") {
                return track.clips.map(clip => {
                    const file = req.files.find(f => f.fieldname === clip.source);
                    const src = file ? `./assets/${file.originalname}` : "";
                    const asset = spec.assets.find(a => a.id === clip.source);
                    if (asset && asset.type === "video") {
                        return `<video id="${clip.id}" class="clip" src="${src}" loop muted></video>`;
                    }
                    return `<img id="${clip.id}" class="clip" src="${src}" />`;
                }).join("");"""
            
            src = src.replace(old_code, new_code)
            
            # Convert back to list of lines as Jupyter stores it
            lines = [line + '\n' for line in src.split('\n')]
            lines[-1] = lines[-1].rstrip('\n') # last line has no newline
            cell['source'] = lines

with open('Phase_2_Kaggle_PoC.ipynb', 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1)
