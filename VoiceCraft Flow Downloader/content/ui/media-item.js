// content/ui/media-item.js

class MediaItemUI {
  constructor(mediaData, callbacks, isNew = false) {
    this.data = mediaData;
    this.callbacks = callbacks;
    this.isNew = isNew;
    this.element = this.render();
    this.updateSelectionState(); // initialize here, after element is set
  }

  render() {
    const div = document.createElement('div');
    div.className = `fmd-media-item ${this.data.status === 'selected' ? 'selected' : ''}`;
    div.dataset.id = this.data.id;
    div.title = this.data.title || 'Flow Media';

    let mediaEl;
    if (this.data.type === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.src = this.data.url;
      if (this.data.thumbnail && this.data.thumbnail !== this.data.url) {
          mediaEl.poster = this.data.thumbnail;
      }
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = this.data.thumbnail;
    }
    
    // Auto-remove garbage API endpoints caught by NetworkObserver that fail to render as images
    mediaEl.onerror = () => {
       this.remove();
    };
    
    div.appendChild(mediaEl);

    // Status overlay (for downloading/queued/error)
    const overlay = document.createElement('div');
    overlay.className = 'fmd-media-overlay';
    overlay.style.display = 'none';
    div.appendChild(overlay);
    this.overlayEl = overlay;

    const badge = document.createElement('div');
    badge.className = 'fmd-media-badge';
    badge.textContent = this.data.type === 'video' ? 'VID' : 'IMG';
    div.appendChild(badge);

    if (this.data.title) {
      const resBadge = document.createElement('div');
      resBadge.className = 'fmd-res-badge';
      // Clean filename format just like DownloadManager does for the final file
      let displayTitle = this.data.title.replace(/[\/\\?%*:|"<> \n\r]/g, '-').replace(/--+/g, '-');
      resBadge.textContent = displayTitle;
      resBadge.title = displayTitle; // Show full name on mouse hover
      div.appendChild(resBadge);
    }

    if (this.isNew) {
      const newBadge = document.createElement('div');
      newBadge.className = 'fmd-new-badge';
      newBadge.textContent = 'NEW';
      div.appendChild(newBadge);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'fmd-remove-btn';
    removeBtn.innerHTML = '&times;'; 
    removeBtn.title = "Remove from list";
    div.appendChild(removeBtn);

    // Event listeners
    div.addEventListener('click', (e) => {
      if (e.target === removeBtn) return;
      if (this.data.status === 'downloading' || this.data.status === 'queued') return;
      if (this.data.status === 'error') {
        // Retry
        this.data.status = 'selected';
        this.updateSelectionState();
        this.callbacks.onSelectionChange();
        return;
      }
      this.toggleSelection();
    });

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove();
    });

    return div;
  }

  toggleSelection() {
    if (this.data.status === 'downloaded') return; // Cannot unselect downloaded
    const isSelected = this.data.status === 'selected';
    this.data.status = isSelected ? 'detected' : 'selected';
    this.updateSelectionState();
    this.callbacks.onSelectionChange();
  }

  remove() {
    this.data.status = 'rejected';
    this.element.remove();
    this.callbacks.onRemove(this.data);
  }

  updateSelectionState() {
    // Reset classes
    this.element.classList.remove('selected', 'downloading', 'error', 'downloaded');
    
    // Set base style
    if (this.data.status === 'selected' || this.data.status === 'queued') {
      this.element.classList.add('selected');
      this.overlayEl.style.display = 'none';
    } else if (this.data.status === 'downloading') {
      this.element.classList.add('downloading');
      this.overlayEl.style.display = 'flex';
      this.overlayEl.innerHTML = `<span style="font-size: 24px; color: white;">&#8987;</span>`; // Hourglass
    } else if (this.data.status === 'downloaded') {
      this.element.classList.add('downloaded');
      this.overlayEl.style.display = 'flex';
      this.overlayEl.innerHTML = `<span style="font-size: 24px; color: #4CAF50;">&#10003;</span>`; // Checkmark
    } else if (this.data.status === 'error') {
      this.element.classList.add('error');
      this.overlayEl.style.display = 'flex';
      this.overlayEl.innerHTML = `<span style="font-size: 24px; color: #F44336;">&#9888;</span><br><span style="font-size: 10px; color: white; margin-top: 4px;">Retry</span>`; // Warning
    } else {
      this.overlayEl.style.display = 'none';
    }
  }
}

window.MediaItemUI = MediaItemUI;
