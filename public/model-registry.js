// Model-capability registry + task-aware router — the first piece of AI
// Director 2.0. It answers one question: given the models THIS Puter instance
// actually offers, which one is best for a specific production task under the
// current cost objective?
//
// It replaces the old static family-preference regex (one order for every
// task) with per-task scoring over capability profiles. Unknown models get a
// sensible heuristic profile so a self-hosted instance with an unfamiliar
// roster still routes well.
//
// window.BlvckModels
//   profileFor(model)                 -> capability profile {0..1}
//   score(model, task, objective)     -> number
//   orderForTask(models, task, opts)  -> model ids, best first
//   pickForTask(models, task, opts)   -> best model id (or null)
//   OBJECTIVES / TASKS                -> introspection for the UI
(() => {
  'use strict';

  // Capability profile dimensions, each 0..1. `cost` is a spend tier
  // (0 = cheapest, 1 = most expensive); `speed` is throughput (1 = fastest).
  const DEFAULT = { reasoning: .70, storytelling: .70, planning: .70, coding: .72, structure: .76, speed: .70, cost: .40, reliability: .70 };

  // Known families, matched by id/name substring (first match wins). Values are
  // relative judgements, not benchmarks — enough to rank sensibly per task.
  const FAMILIES = [
    { re: /(claude).*(opus)/i,            caps: { reasoning: .95, storytelling: .95, planning: .92, coding: .90, structure: .90, speed: .38, cost: .95, reliability: .92 } },
    { re: /(claude).*(sonnet)/i,          caps: { reasoning: .89, storytelling: .91, planning: .89, coding: .89, structure: .90, speed: .62, cost: .60, reliability: .93 } },
    { re: /(claude).*(haiku)/i,           caps: { reasoning: .72, storytelling: .76, planning: .73, coding: .77, structure: .84, speed: .90, cost: .25, reliability: .89 } },
    { re: /\bo[13]\b|gpt-.*o[13]|reasoning/i, caps: { reasoning: .96, storytelling: .70, planning: .92, coding: .90, structure: .82, speed: .30, cost: .90, reliability: .86 } },
    { re: /gpt-5.*nano|gpt-.*nano/i,      caps: { reasoning: .63, storytelling: .61, planning: .63, coding: .70, structure: .82, speed: .95, cost: .15, reliability: .82 } },
    { re: /gpt-5.*mini|gpt-.*mini/i,      caps: { reasoning: .80, storytelling: .78, planning: .80, coding: .83, structure: .86, speed: .82, cost: .38, reliability: .85 } },
    { re: /gpt-5/i,                       caps: { reasoning: .93, storytelling: .88, planning: .90, coding: .91, structure: .88, speed: .52, cost: .85, reliability: .88 } },
    { re: /gpt-4o|gpt-4\.1|gpt-4/i,       caps: { reasoning: .83, storytelling: .83, planning: .81, coding: .83, structure: .83, speed: .70, cost: .52, reliability: .86 } },
    { re: /gemini.*(flash|lite)/i,        caps: { reasoning: .73, storytelling: .73, planning: .73, coding: .75, structure: .83, speed: .92, cost: .20, reliability: .83 } },
    { re: /gemini/i,                      caps: { reasoning: .88, storytelling: .83, planning: .86, coding: .85, structure: .85, speed: .56, cost: .58, reliability: .84 } },
    { re: /deepseek.*(reason|r1)/i,       caps: { reasoning: .91, storytelling: .70, planning: .86, coding: .89, structure: .78, speed: .44, cost: .30, reliability: .81 } },
    { re: /deepseek/i,                    caps: { reasoning: .79, storytelling: .77, planning: .77, coding: .81, structure: .81, speed: .70, cost: .20, reliability: .81 } },
    { re: /qwen/i,                        caps: { reasoning: .79, storytelling: .75, planning: .77, coding: .83, structure: .81, speed: .72, cost: .20, reliability: .79 } },
    { re: /grok/i,                        caps: { reasoning: .83, storytelling: .83, planning: .81, coding: .81, structure: .81, speed: .60, cost: .52, reliability: .81 } },
    { re: /llama/i,                       caps: { reasoning: .75, storytelling: .75, planning: .73, coding: .77, structure: .77, speed: .72, cost: .18, reliability: .77 } },
    { re: /mistral|mixtral/i,             caps: { reasoning: .75, storytelling: .75, planning: .73, coding: .77, structure: .79, speed: .76, cost: .20, reliability: .79 } },
    { re: /glm/i,                         caps: { reasoning: .77, storytelling: .75, planning: .75, coding: .83, structure: .79, speed: .70, cost: .22, reliability: .77 } },
    { re: /kimi|moonshot/i,               caps: { reasoning: .81, storytelling: .79, planning: .79, coding: .81, structure: .79, speed: .60, cost: .30, reliability: .79 } },
    { re: /phi/i,                         caps: { reasoning: .68, storytelling: .64, planning: .66, coding: .73, structure: .77, speed: .90, cost: .12, reliability: .75 } }
  ];

  // Per-task capability weights (the dims that matter for that job). cost and
  // speed are handled separately by the objective, not here.
  const TASKS = {
    research:      { reasoning: .55, planning: .15, structure: .10, storytelling: .20 },
    script:        { storytelling: .60, reasoning: .25, planning: .15 },
    refine:        { storytelling: .55, reasoning: .30, structure: .15 },
    bible:         { reasoning: .40, storytelling: .35, structure: .25 },
    storyboard:    { planning: .40, structure: .35, reasoning: .25 },
    'image-prompt':{ storytelling: .70, structure: .30 },
    seo:           { structure: .40, reasoning: .35, storytelling: .25 },
    director:      { reasoning: .45, storytelling: .35, structure: .20 },
    audit:         { reasoning: .45, structure: .35, storytelling: .20 },
    code:          { coding: .70, reasoning: .30 },
    chat:          { reasoning: .40, storytelling: .30, structure: .30 }
  };

  // Objective modes weight cost and speed against quality.
  const OBJECTIVES = {
    quality:  { cost: .04, speed: .03 },
    balanced: { cost: .18, speed: .08 },
    cost:     { cost: .55, speed: .22 }
  };

  function idOf(model) { return typeof model === 'string' ? model : (model && (model.id || model.model || model.name)) || ''; }

  function profileFor(model) {
    const hay = typeof model === 'string' ? model
      : [model && model.id, model && model.name, model && model.provider].filter(Boolean).join(' ');
    for (const f of FAMILIES) if (f.re.test(hay)) return f.caps;
    return DEFAULT;
  }

  function isDated(id) { return /\d{8}|\d{4}-\d{2}-\d{2}/.test(String(id)); }

  function score(model, task, objective) {
    const caps = profileFor(model);
    const weights = TASKS[task] || TASKS.chat;
    const obj = OBJECTIVES[objective] || OBJECTIVES.balanced;
    let base = 0;
    for (const k in weights) base += weights[k] * (caps[k] != null ? caps[k] : DEFAULT[k]);
    // Quality-forward score, minus spend, plus a little for speed and proven reliability.
    let s = base + 0.10 * caps.reliability - obj.cost * caps.cost + obj.speed * caps.speed;
    if (isDated(idOf(model))) s -= 0.03; // prefer undated (dated snapshots get retired)
    return s;
  }

  function normalizeObjective(o) { return OBJECTIVES[o] ? o : 'balanced'; }

  function orderForTask(models, task, opts) {
    const objective = normalizeObjective(opts && opts.objective);
    const exclude = new Set((opts && opts.exclude) || []);
    return (models || [])
      .map((m) => ({ id: idOf(m), s: score(m, task, objective) }))
      .filter((x) => x.id && !exclude.has(x.id))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.id);
  }

  function pickForTask(models, task, opts) {
    return orderForTask(models, task, opts)[0] || null;
  }

  window.BlvckModels = {
    TASKS: Object.keys(TASKS),
    OBJECTIVES: Object.keys(OBJECTIVES),
    profileFor,
    score,
    orderForTask,
    pickForTask,
    // Short human explanation of a pick, for transparency UIs.
    explain(model, task) {
      const c = profileFor(model);
      const top = Object.entries(TASKS[task] || TASKS.chat).sort((a, b) => b[1] - a[1])[0];
      const dim = top && top[0];
      return dim ? `${idOf(model)} — strong ${dim} (${Math.round((c[dim] || 0) * 100)}/100)` : idOf(model);
    }
  };
})();
