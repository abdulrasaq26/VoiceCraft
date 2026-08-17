// Historical Accuracy Engine & Anachronism Guard for Blvck-TTS v4.0
// Audits scripts & visual prompts across 7 dimensions (clothing, architecture, weapons, food, geography, social class, metallurgy)
(() => {
  'use strict';

  // Anachronism rules database for common historical errors
  const ANACHRONISM_RULES = [
    {
      category: 'Food & Agriculture',
      era: 'Pre-1492 Europe (e.g. 1345 Black Death)',
      forbidden: ['potato', 'potatoes', 'tomato', 'tomatoes', 'maize', 'corn', 'chili', 'tobacco', 'chocolate', 'cocoa', 'turkey'],
      reason: 'New World crops (potatoes, tomatoes, corn, tobacco) were not available in Europe before 1492 Columbus contact.',
      fix: 'Replace with turnip, cabbage, rye bread, barley stew, or leeks.'
    },
    {
      category: 'Clothing & Materials',
      era: 'Medieval / Renaissance',
      forbidden: ['zipper', 'zippers', 'velcro', 'synthetic dye', 'nylon', 'polyester', 'denim', 'jeans', 'wristwatch'],
      reason: 'Modern fasteners and synthetic fabrics did not exist in pre-industrial eras.',
      fix: 'Replace with linen, wool, leather ties, bronze buckles, or pewter buttons.'
    },
    {
      category: 'Weapons & Metallurgy',
      era: '14th Century Medieval',
      forbidden: ['musket', 'flintlock', 'rapier', 'revolver', 'bayonet', 'stainless steel'],
      reason: 'Handheld firearms and rapiers belong to later eras.',
      fix: 'Use longbow, broadsword, poleaxe, spear, or wrought iron armor.'
    },
    {
      category: 'Technology & Everyday Items',
      era: 'Pre-19th Century',
      forbidden: ['light bulb', 'flashlight', 'matches', 'safety pin', 'plastic', 'telephone', 'telegraph'],
      reason: 'Modern electrical and chemical inventions violate historical accuracy.',
      fix: 'Use beeswax candle, oil lamp, torch, or tinderbox.'
    }
  ];

  function auditText(text, eraFilter = '1345') {
    const textLower = String(text || '').toLowerCase();
    const findings = [];

    for (const rule of ANACHRONISM_RULES) {
      for (const term of rule.forbidden) {
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(textLower)) {
          findings.push({
            term,
            category: rule.category,
            era: rule.era,
            reason: rule.reason,
            suggestedFix: rule.fix
          });
        }
      }
    }

    return {
      passed: findings.length === 0,
      findings_count: findings.length,
      findings
    };
  }

  // LLM-based deep audit for complex historical nuances
  async function deepAuditScript(scriptText, era = '14th Century Europe') {
    if (!window.BlvckAI || !window.AIManager.chat) {
      return auditText(scriptText); // Fallback to rule audit
    }

    const prompt = `You are an expert Historical Accuracy & Anachronism Auditor.
Audit the following script for anachronisms in clothing, architecture, weapons, food, geography, and social class for the era: "${era}".

Script:
"${scriptText}"

Return JSON ONLY in format:
{
  "passed": boolean,
  "anachronisms": [
    { "term": "...", "issue": "...", "fix": "..." }
  ],
  "historicalScore": 0-100
}`;

    try {
      const respText = await window.AIManager.chat(prompt);
      const jsonMatch = respText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('[HistoricalAccuracy] Deep audit failed, falling back to rule audit:', e);
    }
    return auditText(scriptText);
  }

  window.HistoricalAccuracy = {
    auditText,
    deepAuditScript,
    rules: ANACHRONISM_RULES
  };
})();
