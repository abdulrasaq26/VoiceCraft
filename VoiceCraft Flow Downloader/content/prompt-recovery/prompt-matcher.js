class PromptMatcher {
  constructor(library = []) {
    this.library = library;
  }

  match(failedPromptRaw) {
    if (!failedPromptRaw || this.library.length === 0) {
      return { match: false, reasons: ["Empty input or library"] };
    }

    const failedNormalized = window.PromptNormalizer.normalize(failedPromptRaw);
    
    // Check if the user accidentally included the identifier in the failed prompt text
    const explicitIdMatch = failedPromptRaw.match(/(?:^|\s)(#[a-zA-Z0-9_-]+)\b/);
    if (explicitIdMatch) {
      const id = explicitIdMatch[1];
      const exactRecord = this.library.find(p => p.identifier === id);
      if (exactRecord) {
        return {
          match: true,
          identifier: exactRecord.identifier,
          confidence: 1.0,
          matchedPrompt: exactRecord,
          reasons: ["Exact identifier recovered from failed prompt text"]
        };
      }
    }

    const candidates = [];

    for (const record of this.library) {
      // Normalize the library prompt on the fly (or this could be pre-calculated)
      const origNormalized = window.PromptNormalizer.normalize(record.promptBody);
      
      const score = window.SimilarityEngine.calculate(origNormalized, failedNormalized);
      
      if (score > 0) {
        candidates.push({
          record: record,
          score: score
        });
      }
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { match: false, reasons: ["No overlapping tokens found in library."] };
    }

    const bestMatch = candidates[0];
    
    // Check for ambiguity
    const isAmbiguous = candidates.length > 1 && (candidates[0].score - candidates[1].score < 0.05) && candidates[0].score < 0.95;

    return {
      match: bestMatch.score >= 0.7, // Minimum threshold to be considered a match
      identifier: bestMatch.record.identifier,
      confidence: parseFloat(bestMatch.score.toFixed(4)),
      matchedPrompt: bestMatch.record,
      isAmbiguous: isAmbiguous,
      alternatives: isAmbiguous ? candidates.slice(1, 4) : [],
      reasons: [
        `${(bestMatch.score * 100).toFixed(1)}% similarity score`,
        isAmbiguous ? "Multiple similar prompts detected" : "Clear best match"
      ]
    };
  }
}

window.PromptMatcher = PromptMatcher;
