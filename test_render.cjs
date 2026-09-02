const fs = require('fs');

async function download(url, dest) {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buffer));
}

async function run() {
    console.log("Downloading real images for the test...");
    await download("https://images.unsplash.com/photo-1506744626753-eda8151a743b?w=1920&q=80", "img1.jpg");
    await download("https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1920&q=80", "img2.jpg");

    const fd = new FormData();
    
    // Construct the Composition JSON schema
    const spec = {
        project: {
            width: 1920,
            height: 1080,
            fps: 30,
            duration: 10
        },
        assets: [
            { id: "asset_img1", type: "image", filename: "img1.jpg" },
            { id: "asset_img2", type: "image", filename: "img2.jpg" },
            { id: "asset_audio1", type: "audio", filename: "ted.wav" }
        ],
        tracks: [
            {
                type: "video", // The backend script maps both 'video' and 'image' tracks to <img> tags in our V10 script
                clips: [
                    {
                        id: "clip1",
                        source: "asset_img1",
                        start: 0,
                        duration: 5,
                        animations: [
                            { property: "scale", keyframes: [{ time: 0, value: 1.0 }, { time: 5, value: 1.2 }] }
                        ],
                        transition: { in: { type: "fade", duration: 1 } }
                    },
                    {
                        id: "clip2",
                        source: "asset_img2",
                        start: 5,
                        duration: 5,
                        animations: [
                            { property: "scale", keyframes: [{ time: 0, value: 1.0 }, { time: 5, value: 1.2 }] }
                        ],
                        transition: { in: { type: "fade", duration: 1 } }
                    }
                ]
            },
            {
                type: "text",
                clips: [
                    {
                        id: "text1",
                        content: "Phase 3 Vertical Slice!",
                        start: 2,
                        duration: 6,
                        transition: { in: { type: "fade", duration: 1 } }
                    }
                ]
            }
        ],
        audio: [
            {
                id: "audio1",
                source: "asset_audio1",
                start: 0,
                volume: 1.0
            }
        ]
    };

    fd.append("spec", JSON.stringify(spec));

    // Append assets to formData
    const img1Blob = new Blob([fs.readFileSync("img1.jpg")]);
    const img2Blob = new Blob([fs.readFileSync("img2.jpg")]);
    const audioBlob = new Blob([fs.readFileSync("ted.wav")]);

    fd.append("asset_img1", img1Blob, "img1.jpg");
    fd.append("asset_img2", img2Blob, "img2.jpg");
    fd.append("asset_audio1", audioBlob, "ted.wav");

    console.log("Sending POST /render request...");
    
    try {
        const res = await fetch("https://agony-secret-trapdoor.ngrok-free.dev/render", {
            method: "POST",
            headers: {
                "Authorization": "Bearer test-secret-token", "ngrok-skip-browser-warning": "1"
            },
            body: fd
        });

        const text = await res.text(); console.log("Body:", text.substring(0, 500)); const data = JSON.parse(text);
        console.log("Response:", res.status, data);

        if (data.job_id) {
            console.log(`Job queued! ID: ${data.job_id}`);
            // Poll for progress
            const interval = setInterval(async () => {
                const pRes = await fetch(`https://agony-secret-trapdoor.ngrok-free.dev/render/${data.job_id}`, {
                    headers: {
                        "Authorization": "Bearer test-secret-token", "ngrok-skip-browser-warning": "1",
                        "ngrok-skip-browser-warning": "1"
                    }
                });
                const pData = await pRes.json();
                console.log("Status:", pData.status, "Progress:", pData.progress);
                if (pData.status === "completed" || pData.status === "failed") {
                    clearInterval(interval);
                    if (pData.status === "completed") {
                        console.log("Downloading result...");
                        const dRes = await fetch(`https://agony-secret-trapdoor.ngrok-free.dev/render/${data.job_id}/download`, {
                            headers: { "ngrok-skip-browser-warning": "1" }
                        });
                        const buffer = await dRes.arrayBuffer();
                        fs.writeFileSync("test_output.mp4", Buffer.from(buffer));
                        console.log("Saved test_output.mp4");
                        process.exit(0);
                    } else {
                        console.log("Failed:", pData.error);
                        process.exit(1);
                    }
                }
            }, 5000);
        }
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

run();
