class GenerationReconciler {
    constructor() {
        this.expectedPrompts = new Map(); // id -> record
        this.unknownAssets = [];
    }
    
    initialize(promptLibrary) {
        this.expectedPrompts.clear();
        const parsed = window.PromptParser.parse(promptLibrary);
        
        parsed.forEach(p => {
            this.expectedPrompts.set(p.id, {
                id: p.id,
                identifier: p.identifier,
                cleanName: p.cleanName,
                originalPrompt: p.originalPrompt,
                promptBody: p.promptBody,
                status: 'missing',
                generatedCount: 0,
                matchedAssets: []
            });
        });
    }
    
    reconcile() {
        const assets = window.FlowResultDetector.getDetectedAssets();
        this.unknownAssets = [];
        
        // Reset counts to accurately reflect current visible Flow state
        for (const [id, record] of this.expectedPrompts.entries()) {
            record.status = 'missing';
            record.generatedCount = 0;
            record.matchedAssets = [];
        }
        
        // Match assets
        for (const asset of assets) {
            let matchedRecord = null;
            
            const normalizedAssetTitle = window.NameNormalizer ? window.NameNormalizer.normalize(asset.title) : asset.cleanName;
            
            // Try to match the asset to an expected prompt
            for (const [id, record] of this.expectedPrompts.entries()) {
                const normalizedPromptId = window.NameNormalizer ? window.NameNormalizer.normalize(record.identifier) : record.identifier;
                const normalizedPromptName = window.NameNormalizer ? window.NameNormalizer.normalize(record.cleanName) : record.cleanName;
                
                if (normalizedAssetTitle === normalizedPromptId || normalizedAssetTitle === normalizedPromptName) {
                    if (record.status === 'missing') {
                        // Perfect match, consume it immediately for a missing prompt
                        matchedRecord = record;
                        break;
                    } else if (!matchedRecord) {
                        // Fallback match, keep looking for a missing one, but remember this
                        matchedRecord = record;
                    }
                }
            }
            
            if (matchedRecord) {
                matchedRecord.status = 'generated';
                matchedRecord.generatedCount++;
                matchedRecord.matchedAssets.push(asset);
            } else {
                this.unknownAssets.push(asset);
            }
        }
    }
    
    getStats() {
        let expected = 0;
        let generated = 0;
        let missing = 0;
        
        for (const record of this.expectedPrompts.values()) {
            expected++;
            if (record.status === 'generated') generated++;
            else missing++;
        }
        
        return { expected, generated, missing };
    }
    
    getMissingPrompts() {
        return Array.from(this.expectedPrompts.values()).filter(p => p.status === 'missing');
    }
    
    getGeneratedPrompts() {
        return Array.from(this.expectedPrompts.values()).filter(p => p.status === 'generated');
    }
}
window.GenerationReconciler = GenerationReconciler;
