import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";

const spec = {
  project: { width: 1280, height: 720, fps: 30, duration: 10 },
  assets: [
    { id: "asset_img1", type: "image", filename: "img1.jpg" },
    { id: "asset_img2", type: "image", filename: "img2.jpg" }
  ],
  tracks: [
    {
      type: "visual",
      clips: [
        {
          id: "clip_0",
          assetId: "asset_img1",
          start: 0,
          duration: 5,
          animations: [{ property: "scale", from: 1.0, to: 1.2, duration: 5 }],
          transitionIn: { type: "fade", duration: 1 },
          transitionOut: null
        },
        {
          id: "clip_1",
          assetId: "asset_img2",
          start: 5,
          duration: 5,
          animations: [],
          transitionIn: { type: "crossfade", duration: 1 },
          transitionOut: null
        }
      ]
    },
    {
      type: "text",
      clips: [
        {
          id: "cap_0",
          text: "HyperFrames Renderer",
          start: 2,
          duration: 4,
          typography: { style: "classic" },
          animations: [{ property: "opacity", from: 0, to: 1, duration: 0.5 }]
        }
      ]
    }
  ],
  audio: []
};

const form = new FormData();
form.append("spec", JSON.stringify(spec));
form.append("asset_img1", fs.readFileSync("img1.jpg"), "img1.jpg");
form.append("asset_img2", fs.readFileSync("img2.jpg"), "img2.jpg");

console.log("Sending POST to /api/auto-editor/render-hyperframes...");
const res = await fetch("http://localhost:3000/api/auto-editor/render-hyperframes", {
  method: "POST",
  body: form
});

if (!res.ok) {
  const t = await res.text();
  throw new Error(`Failed: ${res.status} ${t}`);
}

const { jobId } = await res.json();
console.log("Job ID:", jobId);

let done = false;
while (!done) {
  const evRes = await fetch(`http://localhost:3000/api/auto-editor/status`);
  const jobs = await evRes.json();
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    console.log(`Status: ${job.status}, Percent: ${job.percent}%`);
    if (job.status === "done" || job.status === "error") {
      done = true;
    }
  }
  await new Promise(r => setTimeout(r, 2000));
}
