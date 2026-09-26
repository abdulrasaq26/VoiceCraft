class PromptParser {
  /**
   * Parses a block of text containing multiple prompts into structured records.
   * @param {string} rawText 
   * @returns {Array} Array of prompt objects
   */
  static parse(rawText) {
    if (!rawText) return [];
    
    // Split by lines that start with an identifier (e.g., #0-21, #john, #scene_1)
    // We use a regex that looks for a newline (or start of string) followed by optional whitespace and a #
    const parts = rawText.split(/(?=(?:^|\n)\s*#[a-zA-Z0-9_-]+)/g);
    
    const prompts = [];
    let idCounter = 1;

    for (let part of parts) {
      part = part.trim();
      if (!part) continue;

      // Extract the identifier and the rest of the prompt
      const match = part.match(/^(#[a-zA-Z0-9_-]+)\s*(.*)$/is);
      if (match) {
        const identifier = match[1];
        const cleanName = identifier.substring(1); // Remove the #
        const promptBody = match[2].trim();
        
        prompts.push({
          id: `prompt_${Date.now()}_${idCounter++}`,
          identifier: identifier,
          cleanName: cleanName,
          originalPrompt: part,
          promptBody: promptBody,
          status: 'available'
        });
      }
    }
    
    return prompts;
  }
}

window.PromptParser = PromptParser;
