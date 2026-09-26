// content/prompt-recovery/reference-engine.js

class ReferenceStore {
    constructor() {
        this.references = new Map(); // name -> record
    }

    parseAndStore(rawText) {
        this.references.clear();
        const parsed = window.PromptParser.parse(rawText);
        parsed.forEach(p => {
            const name = p.cleanName.toLowerCase();
            this.references.set(name, {
                id: p.id,
                identifier: p.identifier,
                referenceName: p.cleanName,
                trigger: `@${p.cleanName}`,
                referencePrompt: p.promptBody,
                status: 'available'
            });
        });
        return this.references.size;
    }

    getReference(name) {
        return this.references.get(name.toLowerCase());
    }

    getAll() {
        return Array.from(this.references.values());
    }
}

class FlowPromptBuilder {
    constructor(store) {
        this.store = store;
        this.saveInstruction = "Every prompt have a name like this #0-00, i want you to save the image as the name i attached to the prompt like this 0-00";
    }

    buildPrompt(originalParsedPrompt) {
        const body = originalParsedPrompt.originalPrompt;
        
        // Find all @mentions
        const mentions = body.match(/@([a-zA-Z0-9_-]+)/g) || [];
        const uniqueMentions = [...new Set(mentions.map(m => m.substring(1).toLowerCase()))];
        
        const knownReferences = [];
        const unknownReferences = [];
        
        uniqueMentions.forEach(m => {
            const ref = this.store.getReference(m);
            if (ref) knownReferences.push(ref);
            else unknownReferences.push(m);
        });

        // Construct Normal Prompt
        let normalPrompt = body;
        if (!normalPrompt.includes(this.saveInstruction)) {
            normalPrompt = normalPrompt.trimEnd() + ` "SAVE-NAME INSTRUCTION:\n${this.saveInstruction}"`;
        }

        // Construct Reference-Ready Prompt
        let refReadyPrompt = body.trimEnd();
        if (knownReferences.length > 0) {
            let refInstText = ` "REFERENCE INSTRUCTIONS: `;
            knownReferences.forEach((ref, index) => {
                refInstText += `Use the attached reference image named "${ref.referenceName}" as the visual reference for ${ref.trigger} wherever ${ref.trigger} appears in this prompt. Maintain the same recognizable visual identity and characteristics of the referenced asset while adapting it naturally to the scene.`;
                if (index < knownReferences.length - 1) refInstText += ' ';
            });
            refInstText += '"';
            
            if (!refReadyPrompt.includes("REFERENCE INSTRUCTIONS:")) {
                refReadyPrompt += refInstText;
            }
        }
        
        if (!refReadyPrompt.includes(this.saveInstruction)) {
            refReadyPrompt += ` "SAVE-NAME INSTRUCTION:\n${this.saveInstruction}"`;
        }

        return {
            originalParsed: originalParsedPrompt,
            knownReferences,
            unknownReferences,
            normalPrompt,
            refReadyPrompt,
            hasReferences: knownReferences.length > 0
        };
    }

    buildBatch(imageLibraryText) {
        const parsedPrompts = window.PromptParser.parse(imageLibraryText);
        return parsedPrompts.map(p => this.buildPrompt(p));
    }
}

window.ReferenceStore = ReferenceStore;
window.FlowPromptBuilder = FlowPromptBuilder;
