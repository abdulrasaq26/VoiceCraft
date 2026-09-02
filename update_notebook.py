import json

with open('Phase_2_Kaggle_PoC.ipynb', 'r', encoding='utf-8') as f:
    nb = json.load(f)

for cell in nb['cells']:
    if cell['cell_type'] == 'code':
        src = ''.join(cell['source'])
        if 'server.cjs' in src:
            src = src.replace('const AUTH_TOKEN = process.env.AUTH_TOKEN || "test-secret-token";\n', '')
            auth_block = """const auth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

"""
            src = src.replace(auth_block, '')
            src = src.replace('app.post("/render", auth, upload.any(),', 'app.get("/status", (req, res) => res.json({status: "ok"}));\n\napp.post("/render", upload.any(),')
            src = src.replace('app.get("/render/:id", auth,', 'app.get("/render/:id",')
            
            # Convert back to list of lines as Jupyter stores it
            lines = [line + '\n' for line in src.split('\n')]
            lines[-1] = lines[-1].rstrip('\n') # last line has no newline
            cell['source'] = lines

with open('Phase_2_Kaggle_PoC.ipynb', 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1)
