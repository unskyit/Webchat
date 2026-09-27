// utils.js - Cryptography, encoding, and timing helpers

const Utils = {
  // Cryptographically strong random ID
  generateId: () => {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },

  // Base64URL Encoding (Safe for URLs, handles UTF-8)
  encodeBase64Url: (str) => {
    const utf8Bytes = new TextEncoder().encode(str);
    const base64 = btoa(String.fromCharCode(...utf8Bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  // Base64URL Decoding
  decodeBase64Url: (base64Url) => {
    try {
      let base64 = base64Url.replace/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    } catch (e) {
      return null;
    }
  },

  // DOM creation helper to prevent XSS
  createElement: (tag, textContent = '', className = '') => {
    const el = document.createElement(tag);
    if (textContent) el.textContent = textContent;
    if (className) el.className = className;
    return el;
  }
};
