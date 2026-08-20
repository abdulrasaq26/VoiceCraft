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
// Taken by brace matching, not by slicing a fixed number of characters. The
// fixed window was 1400 chars and silently stopped covering the function when
// the pinned-provider branches were added — every match then failed for a
// reason that had nothing to do with what is being asserted.
const at = mgr.indexOf('    updateUIStatus() {');
let depth = 0, started = false, fn = '';
for (let i = at; i < mgr.length; i++) {
  if (mgr[i] === '{') { depth++; started = true; }
  else if (mgr[i] === '}') {
    depth--;
    if (started && depth === 0) { fn = mgr.slice(at, i + 1); break; }
  }
}
check('the badge painter was found at all', fn.length > 200, fn.length);
check('healthy reads Qwen primary',
      /isQwenHealthy === true/.test(fn) && /Qwen3\.8-27B — Primary/.test(fn));
check('unhealthy reads NIM fallback',
      /isQwenHealthy === false/.test(fn) && /NVIDIA NIM — Fallback/.test(fn));
check('unknown reads neither', /Checking…/.test(fn));
check('unknown is not folded into failure',
      fn.indexOf('isQwenHealthy === false') < fn.indexOf('Checking…'),
      'the null branch must be distinct from the false branch');

console.log('--- a chosen provider is not a verdict ---');
// Picking NIM by hand and NIM being pressed into service after Qwen died look
// identical on the badge unless this holds, and the second reports a failure
// that never happened.
check('a pinned provider reads as chosen', /— Selected/.test(fn));
check('and is decided before the health state is consulted',
      fn.indexOf("choice === 'qwen'") < fn.indexOf('isQwenHealthy === true')
      && fn.indexOf("choice === 'nim'") < fn.indexOf('isQwenHealthy === true'),
      'a stale health verdict must not win over an explicit choice');
// Asserted against the exact string the badge ASSIGNS, not the bare word.
// A previous form searched the raw source for 'Fallback' and matched it inside
// the comment EXPLAINING why the pinned branches must not say it - an
// assertion that failed on the very prose describing the behaviour it checked.
const pinnedRegion = fn.slice(0, fn.indexOf('isQwenHealthy === true'));
check('the pinned branches never paint the fallback label',
      pinnedRegion.indexOf('NVIDIA NIM — Fallback') === -1,
      pinnedRegion.slice(-140));

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
