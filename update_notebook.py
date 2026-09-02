import json

with open("Phase_2_Kaggle_PoC.ipynb", "r") as f:
    nb = json.load(f)

# Update cell 1 (Header)
nb["cells"][0]["source"] = [
    "# Phase 3: HyperFrames Kaggle Proof of Concept (v11 - Fix Multer JobID)\n",
    "Run these cells sequentially to install dependencies, write the composition, start the render server, and expose it via Ngrok."
]

server_cjs = """%%writefile /kaggle/working/hyperframes-render/hf-project/server.cjs
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());

const jobs = new Map();
const AUTH_TOKEN = process.env.AUTH_TOKEN || "test-secret-token";

const auth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // req.body might not be fully parsed yet by multer, so we attach jobId to req itself
        if (!req.jobId) req.jobId = crypto.randomUUID();
        const jobDir = path.join(__dirname, "jobs", req.jobId, "assets");
        fs.mkdirSync(jobDir, { recursive: true });
        cb(null, jobDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

app.post("/render", auth, upload.any(), (req, res) => {
    // If no files were uploaded, destination() wasn't called, so req.jobId might not exist
    if (!req.jobId) req.jobId = crypto.randomUUID();
    
    const jobId = req.jobId;
    const jobDir = path.join(__dirname, "jobs", jobId);
    const outPath = path.join(jobDir, "out.mp4");
    
    jobs.set(jobId, { status: "rendering", progress: 0, file: outPath });
    
    let spec;
    try {
        spec = JSON.parse(req.body.spec);
    } catch (e) {
        return res.status(400).json({ error: "Invalid spec JSON" });
    }

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${spec.project.width}, height=${spec.project.height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      html, body { margin: 0; width: ${spec.project.width}px; height: ${spec.project.height}px; overflow: hidden; background: #000; font-family: sans-serif; }
      #container { position: relative; width: 100%; height: 100%; }
      .clip { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
      .text-layer { position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; color: white; font-size: 120px; text-shadow: 0px 10px 20px rgba(0,0,0,0.8); z-index: 10; opacity: 0;}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="DynamicComposition" data-start="0" data-duration="${spec.project.duration}" data-width="${spec.project.width}" data-height="${spec.project.height}">
      <div id="container">
        ${spec.tracks.map(track => {
            if (track.type === "video" || track.type === "image") {
                return track.clips.map(clip => {
                    const file = req.files.find(f => f.fieldname === clip.source);
                    const src = file ? `./assets/${file.originalname}` : "";
                    return `<img id="${clip.id}" class="clip" src="${src}" />`;
                }).join("");
            } else if (track.type === "text") {
                return track.clips.map(clip => {
                    return `<div id="${clip.id}" class="text-layer">${clip.content}</div>`;
                }).join("");
            }
            return "";
        }).join("")}
      </div>
      <!-- Audio -->
      ${spec.audio.map(a => {
           const file = req.files.find(f => f.fieldname === a.source);
           const src = file ? `./assets/${file.originalname}` : "";
           return `<audio id="${a.id}" src="${src}" loop></audio>`;
      }).join("")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      
      ${spec.tracks.map(track => {
          return track.clips.map(clip => {
              let js = "";
              js += `tl.set("#${clip.id}", { opacity: ${clip.opacity !== undefined ? clip.opacity : 1} }, ${clip.start});\\n`;
              if (clip.transition && clip.transition.in) {
                  js += `tl.fromTo("#${clip.id}", { opacity: 0 }, { opacity: ${clip.opacity !== undefined ? clip.opacity : 1}, duration: ${clip.transition.in.duration} }, ${clip.start});\\n`;
              }
              if (clip.animations) {
                  clip.animations.forEach(anim => {
                      if (anim.property === "scale") {
                           js += `tl.fromTo("#${clip.id}", { scale: ${anim.keyframes[0].value} }, { scale: ${anim.keyframes[1].value}, duration: ${clip.duration}, ease: "none" }, ${clip.start});\\n`;
                      } else if (anim.property === "y") {
                           js += `tl.fromTo("#${clip.id}", { y: ${anim.keyframes[0].value} }, { y: ${anim.keyframes[1].value}, duration: ${clip.duration}, ease: "none" }, ${clip.start});\\n`;
                      }
                  });
              }
              js += `tl.set("#${clip.id}", { opacity: 0 }, ${clip.start + clip.duration});\\n`;
              return js;
          }).join("");
      }).join("")}

      window.__timelines["DynamicComposition"] = tl;
    </script>
  </body>
</html>`;
    
    fs.writeFileSync(path.join(jobDir, "index.html"), html);
    fs.writeFileSync(path.join(jobDir, "hyperframes.json"), JSON.stringify({}));

    const cmd = `npx hyperframes render . DynamicComposition --output out.mp4`;
    
    jobs.set(jobId, { status: "rendering", progress: 0, file: outPath });
    
    const child = exec(cmd, { cwd: jobDir });
    
    child.stdout.on("data", (data) => {
        const str = data.toString();
        if (str.includes("%")) {
             const match = str.match(/(\\d+)%/);
             if (match) jobs.set(jobId, { status: "rendering", progress: parseInt(match[1]), file: outPath });
        }
    });

    child.on("exit", (code) => {
        if (code !== 0) {
            jobs.set(jobId, { status: "failed", error: "Render failed" });
        } else {
            jobs.set(jobId, { status: "completed", progress: 100, file: outPath });
        }
    });
    
    res.json({ job_id: jobId });
});

app.get("/render/:id", auth, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
});

app.get("/render/:id/download", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "completed") return res.status(404).json({ error: "Not ready" });
    res.download(job.file, "render.mp4");
});

app.listen(3000, () => console.log("Render Worker started on port 3000"));
"""

nb["cells"][6] = {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [server_cjs]
}

with open("Phase_2_Kaggle_PoC.ipynb", "w") as f:
    json.dump(nb, f, indent=1)

print("Updated Phase_2_Kaggle_PoC.ipynb to V11.")
