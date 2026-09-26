const fs = require('fs');
const chrome = {
  runtime: { onMessage: { addListener: ()=>{} }, lastError: null },
  storage: { local: { get: ()=>{}, set: ()=>{} } },
  downloads: { download: ()=>{}, onChanged: { addListener: ()=>{} } },
  webRequest: { onCompleted: { addListener: ()=>{} } },
  tabs: { sendMessage: ()=>{} }
};
global.chrome = chrome;
global.self = global;

function importScripts(...files) {
  for (const file of files) {
    const code = fs.readFileSync('background/' + file, 'utf8');
    eval(code);
  }
}
global.importScripts = importScripts;

try {
  const code = fs.readFileSync('background/service-worker.js', 'utf8');
  eval(code);
  console.log("SW SUCCESS");
} catch(e) {
  console.error("SW ERROR", e);
}
