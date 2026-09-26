// content/detection/media-resolver.js

class MediaResolver {
  /**
   * Resolves a media item into a universally downloadable format.
   * If it's a blob: URL, it fetches the data from the page context
   * and converts it to a Data URL. This bypasses Chrome's security 
   * restriction that strips filenames and folders from cross-origin blob downloads.
   */
  static async resolve(item) {
    if (item.type === 'image' && item.url.startsWith('blob:')) {
      try {
        console.log(`Flow Media Downloader: Converting blob image to true PNG...`);
        
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || img.width;
              canvas.height = img.naturalHeight || img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const dataUrl = canvas.toDataURL('image/png');
              
              resolve({
                ...item,
                url: dataUrl,
                mimeType: 'image/png'
              });
            } catch (err) {
              resolve(item);
            }
          };
          img.onerror = () => {
              // Canvas fallback if cross-origin image failed to load
              if (item.element && item.element.tagName === 'IMG') {
                  try {
                    const canvas = document.createElement('canvas');
                    canvas.width = item.width || item.element.naturalWidth || item.element.width;
                    canvas.height = item.height || item.element.naturalHeight || item.element.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(item.element, 0, 0, canvas.width, canvas.height);
                    
                    const dataUrl = canvas.toDataURL('image/png');
                    resolve({
                      ...item,
                      url: dataUrl,
                      mimeType: 'image/png'
                    });
                    return;
                  } catch (e) {}
              }
              resolve(item);
          };
          img.src = item.url;
        });
      } catch (error) {
        return item; 
      }
    }
    
    return item;
  }
}

window.MediaResolver = MediaResolver;
