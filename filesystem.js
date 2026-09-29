// filesystem.js - Direct-to-Disk Streaming & Auto-Save Directory

const FileSystem = {
  directoryHandle: null,
  sessionFolder: null,
  
  // FIX: Explicitly disable on Mobile. Mobile OS sandboxing (Android Scoped Storage) 
  // traps API-saved files in invisible system folders. We want to force the native OS Download Manager.
  isSupported: 'showDirectoryPicker' in window && !(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)),

  async requestDirectory() {
    if (!this.isSupported) {
      alert("Direct folder selection is restricted on mobile devices. Files will automatically route to your public Downloads folder.");
      return false;
    }
    try {
      this.directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      // Create a timestamped session subfolder automatically
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      this.sessionFolder = await this.directoryHandle.getDirectoryHandle(`Webchat-Session-${dateStr}`, { create: true });
      return true;
    } catch (e) {
      console.warn("Directory selection failed or was aborted:", e);
      return false;
    }
  },

  async createWritable(filename) {
    if (!this.sessionFolder) return null;
    try {
      const fileHandle = await this.sessionFolder.getFileHandle(filename, { create: true });
      // Returns a FileSystemWritableFileStream to pipe chunks directly to disk
      const stream = await fileHandle.createWritable();
      return { stream, fileHandle }; 
    } catch (e) {
      console.error("Failed to create writable stream:", e);
      return null;
    }
  }
};
