const fs = require('fs');

const files = [
  "content/detection/fingerprint.js",
  "content/detection/flow-adapter.js",
  "content/detection/media-normalizer.js",
  "content/detection/detector.js",
  "content/detection/mutation-observer.js",
  "content/detection/network-media.js",
  "content/detection/media-resolver.js",
  "content/ui/media-item.js",
  "content/ui/media-tray.js",
  "content/index.js"
];

let globalCode = 'const window = { };\nconst document = { querySelectorAll: ()=>{return []}, body: { appendChild: ()=>{} }, createElement: ()=>{ return { classList: { toggle: ()=>{} }, style: {}, attachShadow: ()=>{ return { querySelector: ()=>{ return { addEventListener: ()=>{} } }, appendChild: ()=>{} } }, appendChild: ()=>{} } } };\nconst chrome = { runtime: { onMessage: { addListener: ()=>{} }, getURL: ()=>"" } };\nconst Node = { ELEMENT_NODE: 1 };\nclass MutationObserver { constructor(){} observe(){} disconnect(){} }\n';
for (const f of files) {
  globalCode += fs.readFileSync(f, 'utf8') + '\n';
}

try {
  eval(globalCode);
  console.log("SUCCESS");
} catch (e) {
  console.error("ERROR", e);
}
