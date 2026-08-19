// The gateway badge must report the provider, not assert one.
//
// Observed: Settings tests Qwen, it passes, Save, the bar reads Qwen — and a
// moment later it reads "NVIDIA NIM (NIM Gateway)". Qwen never stopped being
// primary. workspace-router wrote `NVIDIA NIM (...)` unconditionally on a 3s
// interval, overwriting what AIProviderManager had correctly painted. Two
// writers on one element, and the one that never consulted provider state fired
// last, forever.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';
const router = fs.readFileSync(ROOT + '/workspace-router.js', 'utf8');
const mgr = fs.readFileSync(ROOT + '/ai-provider-manager.js', 'utf8');
const html = fs.readFileSync(ROOT + '/index.html', 'utf8');

// The comment explaining the bug necessarily names the old string, so checks
// about what the CODE does must not read the prose describing what it used to.
const routerCode = router
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

const fails = [];
const check = (n, c, d) => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + n + (c ? '' : '  <- ' + JSON.stringify(d)));
  if (!c) fails.push(n);
};

console.log('--- exactly one writer ---');
const routerWrites = /gatewayEl\s*\.textContent\s*=/.test(routerCode)
  || /getElementById\('mc-gateway-name'\)\s*\.textContent/.test(routerCode);
check('the mission-control timer no longer writes the badge', !routerWrites,
      'workspace-router still assigns to the gateway element');
check('AIProviderManager still owns it', /mc-gateway-name/.test(mgr));
check('the router no longer hardcodes a provider name',
      !/NVIDIA NIM \(/.test(routerCode), 'router still hardcodes the provider name');

console.log('--- the markup asserts nothing ---');
check('the badge does not ship claiming a provider',
      !/id="mc-gateway-name"[^>]*>NVIDIA NIM/.test(html), 'markup still hardcodes NIM');
check('it starts neutral', /id="mc-gateway-name"[^>]*>Checking…</.test(html));
check('and it carries the class the manager paints',
      /id="mc-gateway-name"[^>]*class="[^"]*ai-provider-status/.test(html));

console.log('--- three states, not two ---');
const at = mgr.indexOf('updateUIStatus()');
const fn = mgr.slice(at, at + 1400);
check('healthy reads Qwen primary',
      /isQwenHealthy === true/.test(fn) && /Qwen3\.8-27B — Primary/.test(fn));
check('unhealthy reads NIM fallback',
      /isQwenHealthy === false/.test(fn) && /NVIDIA NIM — Fallback/.test(fn));
check('unknown reads neither', /Checking…/.test(fn));
check('unknown is not folded into failure',
      fn.indexOf('isQwenHealthy === false') < fn.indexOf('Checking…'),
      'the null branch must be distinct from the false branch');

console.log('--- the dead metric went with it ---');
check('chatModel is no longer computed for the badge', !/chatModel/.test(routerCode),
      'workspace-router still computes chatModel');
check('the mismatched guard is gone',
      !/window\.BlvckAI && window\.AIManager\.chatModel/.test(routerCode),
      'the guard checked BlvckAI but called AIManager');

console.log('--- the interval still updates everything else ---');
check('mission control still repaints on an interval',
      /setInterval\(updateMissionControlBar/.test(routerCode));
check('completion still updates', /mc-completion-pct/.test(routerCode));
check('asset count still updates', /mc-assets-count/.test(routerCode));

console.log('\n' + (fails.length ? 'FAILED (' + fails.length + '): ' + fails.join(', ')
                                 : 'GATEWAY LABEL PASSES'));
process.exit(fails.length ? 1 : 0);
