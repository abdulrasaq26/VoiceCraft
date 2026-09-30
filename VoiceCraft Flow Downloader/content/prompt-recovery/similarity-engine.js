class SimilarityEngine {
  /**
   * Calculates token-level similarity between two normalized strings.
   * Handles partial matching (if failed prompt is a substring of original).
   */
  static calculate(original, failed) {
    if (!original || !failed) return 0;
    
    const origTokens = original.split(' ');
    const failTokens = failed.split(' ');
    
    if (origTokens.length === 0 || failTokens.length === 0) return 0;

    // 1. Exact Substring Match (Sequence Similarity)
    if (original.includes(failed)) {
        // If the failed prompt is a perfect substring of the original, it's a very high match.
        // We scale it by how much of the original it covers, but give it a massive boost.
        const coverage = failTokens.length / origTokens.length;
        return Math.min(0.95 + (coverage * 0.05), 1.0); // 95% to 100%
    }
    
    // 2. Jaccard Similarity (Token Intersection)
    const origSet = new Set(origTokens);
    const failSet = new Set(failTokens);
    
    let intersection = 0;
    for (const token of failSet) {
        if (origSet.has(token)) {
            intersection++;
        }
    }
    
    // We calculate similarity based on the length of the FAILED prompt
    // Because the failed prompt might be truncated!
    const tokenSimilarity = intersection / failSet.size;
    
    // 3. Sequence alignment check (simplified)
    // How many tokens appear in the exact same order?
    let maxSequence = 0;
    let currentSequence = 0;
    let origIdx = 0;
    
    for (let i = 0; i < failTokens.length; i++) {
        const fToken = failTokens[i];
        const matchIdx = origTokens.indexOf(fToken, origIdx);
        if (matchIdx !== -1) {
            currentSequence++;
            origIdx = matchIdx + 1;
            if (currentSequence > maxSequence) maxSequence = currentSequence;
        } else {
            currentSequence = 0;
        }
    }
    
    const sequenceScore = maxSequence / failTokens.length;
    
    // Weighted score
    const finalScore = (tokenSimilarity * 0.6) + (sequenceScore * 0.4);
    
    return finalScore;
  }
}

window.SimilarityEngine = SimilarityEngine;
