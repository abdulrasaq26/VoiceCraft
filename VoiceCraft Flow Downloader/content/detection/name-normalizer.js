class NameNormalizer {
    static normalize(rawName) {
        if (!rawName) return "";
        let name = rawName.toString();
        
        // Remove trailing extensions that might have been appended
        name = name.replace(/\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i, '');
        
        // Remove leading hashtag (often used in prompt lists like #0-23)
        name = name.replace(/^#/, '');

        // Standard clean up: replace invalid chars with dash, collapse multiple dashes
        name = name.replace(/[\/\\?%*:|"<> \n\r]/g, '-').replace(/--+/g, '-');
        
        return name.trim();
    }
}
window.NameNormalizer = NameNormalizer;
