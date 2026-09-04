const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// Generate a minimal valid JPEG buffer (solid color) using a tiny JPEG header trick
// We create a 16x16 solid-color JPEG using raw bytes
function solidColorJpeg(r, g, b) {
  // Use canvas-free approach: create an HTML canvas is not available in Node.
  // Instead, use a hardcoded 1x1 BMP converted approach, or use the 'sharp' library...
  // Simplest: use a tiny valid JPEG from a known-good base64 pattern and patch color
  // Since we don't have canvas, we'll just write a small PNG-like file.
  // Actually the simplest approach: write a valid small JPEG with ImageMagick or use
  // a pre-existing tiny JPEG. Let's use a 1-pixel JPEG base64.
  // This base64 is a valid 1x1 white JPEG:
  const base64_1x1 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH7wYLDQsLCwsLDAwcEBEOEBMMDA8NDQ8PEREUFBQUFBQUFBQUFBQUFf/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=";
  return Buffer.from(base64_1x1, "base64");
}

const FormData = require("form-data");

async function runStressTest() {
  console.log("Phase 5 Stress-Test: submitting render...");

  const specPath = path.join(process.cwd(), "scratch/hyperframes-aws/hyperframes/autoeditor-composition/stress-test-spec.json");
  const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
  
  // Remove inline src fields - backend uses filename only
  spec.assets.forEach(a => delete a.src);

  const form = new FormData();
  form.append("spec", JSON.stringify(spec));

  // Append fake JPEG blobs for the 3 visual clips
  const clips = [
    { id: "clip_a", name: "mock_clip_a.jpg" },
    { id: "clip_b", name: "mock_clip_b.jpg" },
    { id: "clip_c", name: "mock_clip_c.jpg" },
  ];

  clips.forEach(c => {
    form.append(c.id, solidColorJpeg(255, 100, 100), { filename: c.name, contentType: "image/jpeg" });
  });

  // Use default aws settings (no credentials in body = uses local profile)
  const resp = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port: 3000,
      path: "/api/auto-editor/render-hyperframes",
      method: "POST",
      headers: form.getHeaders(),
    }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    form.pipe(req);
  });

  console.log("Response:", resp.status, resp.body);

  if (resp.status === 200) {
    const { jobId } = JSON.parse(resp.body);
    console.log("Job ID:", jobId);
    console.log("Polling for progress...");

    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 3000));
      const pollResp = await new Promise((resolve, reject) => {
        http.get(`http://localhost:3000/api/auto-editor/render/${jobId}`, (r) => {
          let d = ""; r.on("data", c => d += c); r.on("end", () => resolve(JSON.parse(d)));
        }).on("error", reject);
      });
      console.log(`Progress: ${pollResp.progress}% | Status: ${pollResp.status}`);
      if (pollResp.status === "completed" || pollResp.status === "done" || pollResp.status === "error") {
        done = true;
        if (pollResp.error) console.error("Render error:", pollResp.error);
        else console.log("Render complete!");
      }
    }
  }
}

runStressTest().catch(console.error);
