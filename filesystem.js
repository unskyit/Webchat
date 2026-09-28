// filesystem.js - Direct-to-Disk Streaming & Auto-Save Directory

const FileSystem = {
  directoryHandle: null,
  sessionFolder: null,
  isSupported: 'showDirectoryPicker' in window,

  async requestDirectory() {
    if (!this.isSupported) {
      alert("Direct disk saving is not supported on this browser. Files will save via standard downloads.");
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
      return await fileHandle.createWritable();
    } catch (e) {
      console.error("Failed to create writable stream:", e);
      return null;
    }
  }
};
