class PromptCleaner {
  /**
   * Cleans a prompt by removing its identifier metadata, leaving only the instructions.
   */
  static clean(record) {
    if (!record || !record.originalPrompt) return '';
    return record.originalPrompt;
  }

  static cleanWithInstruction(record) {
    if (!record || !record.originalPrompt) return '';
    return record.originalPrompt;
  }

  /**
   * Generates the save instruction based on the user's template
   */
  static getSaveInstruction(identifier) {
      const cleanName = identifier.startsWith('#') ? identifier.substring(1) : identifier;
      
      // We can make this configurable in the UI later. For now, hardcode the requested V1 template.
      return `Every prompt have a name like this ${identifier}, I want you to save the image as the name I attached to the prompt like this ${cleanName}.`;
  }
}

window.PromptCleaner = PromptCleaner;
