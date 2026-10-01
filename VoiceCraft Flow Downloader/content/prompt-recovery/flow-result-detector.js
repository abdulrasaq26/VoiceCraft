// content/prompt-recovery/flow-result-detector.js
// Named Flow results, from the shared media registry (not the tray's list,
// which the user can clear or filter).
class FlowResultDetector {
  static getDetectedAssets() {
    const reg = window.FlowMediaRegistry;
    if (!reg) return [];
    return reg.all().filter((a) => a.name).map((a) => ({ title: a.name, cleanName: a.name, key: a.key, flowId: a.flowId }));
  }
}
window.FlowResultDetector = FlowResultDetector;
