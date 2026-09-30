class PromptNormalizer {
  /**
   * Normalizes a prompt for highly accurate fuzzy matching.
   */
  static normalize(text, removeSaveInstruction = true) {
    if (!text) return '';
    
    let normalized = text.toLowerCase();
    
    // Normalize quotes and apostrophes
    normalized = normalized.replace(/['"]/g, "'");
    normalized = normalized.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
    normalized = normalized.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    
    // Normalize dashes
    normalized = normalized.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-");

    // Remove the save instruction if requested (handles slight variations)
    if (removeSaveInstruction) {
        const saveInstructionRegex = /every prompt ha(?:s|ve) a name like this\s*#[^\s,]+[\s,]*i want you to save the image as the name i attached to the prompt like this\s*[^\s.]+\.?/gi;
        normalized = normalized.replace(saveInstructionRegex, '');
    }

    // Strip out the identifier if it somehow got included in the failed prompt text
    normalized = normalized.replace(/(?:^|\s)#[a-zA-Z0-9_-]+\b/g, ' ');

    // Remove punctuation for the final tokenization/comparison layer
    // We keep alphanumeric and spaces
    normalized = normalized.replace(/[^\w\s-]/g, ' ');

    // Collapse whitespace and line breaks
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  }
}

window.PromptNormalizer = PromptNormalizer;
