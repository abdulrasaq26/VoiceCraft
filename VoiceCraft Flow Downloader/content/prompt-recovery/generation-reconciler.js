// content/prompt-recovery/generation-reconciler.js
//
// Prompt Recovery's state: one record per expected prompt,
//
//   { promptId: "#0-14", assetName: "0-14", status: "missing" | "generated", assetIds: [] }
//
// matched against the shared Flow media registry by the name Flow shows on
// each result. The registry only ever grows while the project is open, so a
// prompt that was found stays found even after its tile scrolls out of the
// page; and while Prompt Recovery is listening, a prompt you regenerate flips
// to "generated" as soon as Flow shows it — no refresh, no re-scan.

class GenerationReconciler {
    constructor(registry = window.FlowMediaRegistry) {
        this.registry = registry;
        this.expectedPrompts = new Map(); // name key -> record
        this.listeners = new Set();
        this.unsubscribe = null;
    }

    // ({ changed: [records] }) => void, after any status change.
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    initialize(promptLibrary) {
        this.expectedPrompts.clear();
        const names = window.FlowMediaNames;
        for (const p of window.PromptParser.parse(promptLibrary)) {
            const key = names.key(p.identifier);
            if (!key || this.expectedPrompts.has(key)) continue; // first definition wins
            this.expectedPrompts.set(key, {
                promptId: p.identifier,
                identifier: p.identifier,          // (older callers)
                assetName: names.clean(p.identifier),
                cleanName: names.clean(p.identifier),
                originalPrompt: p.originalPrompt,
                promptBody: p.promptBody,
                status: 'missing',
                assetIds: [],
                generatedCount: 0,
                matchedAt: null,
            });
        }
        this.reconcile();
        this.listen();
    }

    // Keep up with the registry: new or newly named assets.
    listen() {
        if (this.unsubscribe) return;
        this.unsubscribe = this.registry.subscribe((ev) => {
            if (ev.type === 'reset') { this.reconcile(); this.emit([...this.expectedPrompts.values()]); return; }
            const a = ev.asset;
            if (!a || !a.name) return;
            const changed = this.matchAsset(a);
            if (changed.length) this.emit(changed);
        });
    }

    stop() {
        if (this.unsubscribe) this.unsubscribe();
        this.unsubscribe = null;
    }

    emit(changed) {
        for (const fn of this.listeners) { try { fn({ changed }); } catch (e) { console.warn('[Recovery]', e); } }
    }

    // The records this asset satisfies ("0-14" and "0-14 (2)" both count).
    matchAsset(a) {
        const changed = [];
        const k = window.FlowMediaNames.key(a.name);
        const base = k.replace(/\s*\(\d+\)$/, '');
        for (const key of new Set([k, base])) {
            const r = this.expectedPrompts.get(key);
            if (!r || r.assetIds.includes(a.key)) continue;
            r.assetIds.push(a.key);
            r.generatedCount = r.assetIds.length;
            if (r.status !== 'generated') {
                r.status = 'generated';
                r.matchedAt = Date.now();
                changed.push(r);
            }
        }
        return changed;
    }

    // Full recomputation from everything the registry holds.
    reconcile() {
        for (const r of this.expectedPrompts.values()) {
            const found = this.registry.findByName(r.assetName);
            r.assetIds = found.map((a) => a.key);
            r.generatedCount = found.length;
            const was = r.status;
            r.status = found.length ? 'generated' : 'missing';
            if (r.status === 'generated' && was !== 'generated') r.matchedAt = Date.now();
        }
    }

    getStats() {
        let expected = 0, generated = 0;
        for (const r of this.expectedPrompts.values()) { expected++; if (r.status === 'generated') generated++; }
        return { expected, generated, missing: expected - generated, assetsChecked: this.registry.size, assetsNamed: this.registry.named };
    }

    getMissingPrompts() { return [...this.expectedPrompts.values()].filter((p) => p.status === 'missing'); }
    getGeneratedPrompts() { return [...this.expectedPrompts.values()].filter((p) => p.status === 'generated'); }
    get unknownAssets() {
        const expected = new Set(this.expectedPrompts.keys());
        return this.registry.all().filter((a) => a.name && !expected.has(window.FlowMediaNames.key(a.name).replace(/\s*\(\d+\)$/, '')));
    }
}
window.GenerationReconciler = GenerationReconciler;
