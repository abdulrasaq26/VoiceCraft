class NameNormalizer {
  static normalize(rawName) {
    if (!rawName) return '';
    let name = String(rawName).trim();
    if (name.startsWith('#')) {
      name = name.substring(1);
    }
    name = name.replace(/\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i, '');
    return name;
  }
}
window.NameNormalizer = NameNormalizer;
