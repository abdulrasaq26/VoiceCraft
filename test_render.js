const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));

  console.log("Navigating...");
  await page.goto('https://voicecraft-production-88ba.up.railway.app/auto-editor/index.html');
  
  await new Promise(r => setTimeout(r, 5000));
  
  console.log("Creating project...");
  // Simulate clicking create or entering name
  // Since we don't have clips, maybe we can mock the render process?
  // Let's just execute renderWebCodecs directly in the page!
  await page.evaluate(async () => {
    console.log("Starting mock render...");
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    
    // Create a mock video file (e.g. from an empty blob or a tiny valid mp4)
    // Actually, we can just test the ImageBitmap crash.
    const canvas2 = document.createElement("canvas");
    canvas2.width = 100;
    canvas2.height = 100;
    const ctx = canvas2.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0,0,100,100);
    const blob = await new Promise(r => canvas2.toBlob(r, "image/png"));
    const file = new File([blob], "test.png", { type: "image/png" });
    
    const clips = [{ name: "test.png", start: 0, duration: 5, gap: false }];
    const imagesByName = { "test.png": file };
    const videosByName = {};
    
    try {
      await window.renderWebCodecs({
        clips,
        imagesByName,
        videosByName,
        audioFile: null,
        cues: [],
        transitions: [],
        motions: [],
        motionAmount: 0,
        fps: 30,
        resolution: "1920x1080",
        quality: "High",
        writable: null,
        report: (pct, msg) => console.log(`Report: ${pct.toFixed(2)} ${msg}`)
      });
      console.log("Render completed successfully!");
    } catch (e) {
      console.error("RENDER THREW AN ERROR:", e.stack);
    }
  });
  
  await browser.close();
})();
