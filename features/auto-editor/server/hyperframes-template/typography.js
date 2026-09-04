window.CompositionTypography = {
  apply(element, textConfig) {
    // textConfig: { text, typography: { style, size } }
    
    // Add text content
    element.textContent = textConfig.text;
    
    // Add base classes
    element.classList.add('caption-container');
    
    // Apply presets
    if (textConfig.typography && textConfig.typography.style) {
      element.classList.add(`typography-${textConfig.typography.style}`);
    } else {
      element.classList.add('typography-classic'); // default
    }
    
    // In the future: handle character/word reveals by splitting text into spans
    // and animating them with GSAP stagger.
  }
};
