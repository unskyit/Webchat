// app.js - App State, Settings, Cloud OTP, and Chat UI

// 🚨 PASTE YOUR GOOGLE APP SCRIPT URL HERE 🚨
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 

const STATE = { IDLE: 'IDLE', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED', ERROR: 'ERROR' };
let currentState = STATE.IDLE;
let connection = null;

// File Reception State
let incomingFile = null;
let fileChunks = [];
let fileReceivedBytes = 0;

const App = {
  container: document.getElementById('app-container'),
  
  // Settings State
  settings: {
    darkMode: false,
    useCloud: true
  },

  init() {
    // Setup Settings listeners
    document.getElementById('btn-settings').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-overlay').classList.add('hidden');
    
    document.getElementById('toggle-theme').onchange = (e) => {
      App.settings.darkMode = e.target.checked;
      document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode';
    };
    
    document.getElementById('toggle-mode').onchange = (e) => {
      App.settings.useCloud = e.target.checked;
      document.getElementById('mode-desc').textContent = App.settings.useCloud ? "Cloud OTP (Requires Internet)" : "Manual/QR (Works Offline)";
      App.renderIdle(); // Refresh UI to match mode
    };

    // Check for QR/URL manual join
    if (window.location.hash.startsWith('#join=')) {
      const payloadStr = Utils.decodeBase64Url(window.location.hash.substring(6));
      window.history.replaceState(null, '', window.location.pathname);
      if (payloadStr) {
        const signal = Protocol.validateSignal(payloadStr, 'offer');
        if (signal) return App.handleManualJoin(signal);
      }
      App.renderError("Invalid or expired code.");
    } else {
      App.renderIdle();
    }
  },

  setState(newState) { currentState = newState; App.container.innerHTML = ''; },

  renderIdle() {
    App.setState(STATE.IDLE);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.appendChild(Utils.createElement('h1', 'New Session'));
    card.appendChild(Utils.createElement('p', App.settings.useCloud ? 'Enter a custom PIN to create or join.' : 'Create a room or scan a code.'));

    if (App.settings.useCloud) {
      // CLOUD OTP MODE
      const inputOTP = Utils.createElement('input', '', 'otp-input');
      inputOTP.placeholder = "e.g. secret45";
      inputOTP.maxLength = 10;
      
      const btnHost = Utils.createElement('button', 'Create with PIN');
      btnHost.onclick = () => { if(inputOTP.value.trim()) App.hostCloudRoom(inputOTP.value.trim().toLowerCase()); };
      
      const btnJoin = Utils.createElement('button', 'Join with PIN', 'secondary');
      btnJoin.onclick = () => { if(inputOTP.value.trim()) App.joinCloudRoom(inputOTP.value.trim().toLowerCase()); };

      card.appendChild(inputOTP);
      card.appendChild(btnHost);
      card.appendChild(btnJoin);
    } else {
      // MANUAL / OFFLINE MODE
      const btnHost = Utils.createElement('button', 'Create Offline Room');
      btnHost.onclick = () => App.hostManualRoom();
      
      const btnJoin = Utils.createElement('button', 'Paste Connection Code', 'secondary');
      btnJoin.onclick = () => {
        const code = prompt("Paste code here:");
        if (code) {
          const sig = Protocol.validateSignal(Utils.decodeBase64Url(code), 'offer');
          if (sig) App.handleManualJoin(sig);
        }
      };

      card.appendChild(btnHost);
      card.appendChild(btnJoin);
    }

    view.appendChild(card);
    App.container.appendChild(view);
  },

  // ================= CLOUD OTP LOGIC =================
  
  async hostCloudRoom(pin) {
    App.setState(STATE.CONNECTING);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.appendChild(Utils.createElement('h1', 'Room Created'));
    card.appendChild(Utils.createElement('p', `Tell your friend to enter PIN: `));
    card.appendChild(Utils.createElement('h2', pin, 'otp-input'));
    card.appendChild(Utils.createElement('p', 'Waiting for them to join... (Expires in 5m)'));
    view.appendChild(card);
    App.container.appendChild(view);

    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      const offerStr = await connection.generateOffer();
      // Send offer to Google Sheet
      await fetch(APP_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ room: pin, type: 'offer', payload: offerStr })
      });

      // Poll for answer every 3 seconds
      const pollTimer = setInterval(async () => {
        if(currentState !== STATE.CONNECTING) return clearInterval(pollTimer);
        const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_answer`);
        const data = await res.json();
        if (data.payload) {
          clearInterval(pollTimer);
          const answerSignal = Protocol.validateSignal(data.payload, 'answer');
          if (answerSignal) connection.acceptAnswer(answerSignal);
        }
      }, 3000);
    } catch(e) { App.renderError("Cloud connection failed."); }
  },

  async joinCloudRoom(pin) {
    App.setState(STATE.CONNECTING);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.appendChild(Utils.createElement('h1', 'Connecting...'));
    card.appendChild(Utils.createElement('p', `Looking for PIN: ${pin}`));
    view.appendChild(card);
    App.container.appendChild(view);

    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      // Get offer from Google Sheet
      const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_offer`);
      const data = await res.json();
      if (!data.payload) throw new Error("Room not found or expired.");

      const offerSignal = Protocol.validateSignal(data.payload, 'offer');
      const answerStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      
      // Post answer back
      await fetch(APP_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ room: pin, type: 'answer', payload: answerStr })
      });
      
      card.innerHTML = '<h1>Securing P2P Link...</h1>';
    } catch(e) { App.renderError(e.message); }
  },

  // ================= MANUAL / OFFLINE LOGIC =================
  
  async hostManualRoom() {
    App.setState(STATE.CONNECTING);
    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      const offerStr = await connection.generateOffer();
      const base64 = Utils.encodeBase64Url(offerStr);
      const url = `${window.location.origin}${window.location.pathname}#join=${base64}`;

      const view = Utils.createElement('div', '', 'view');
      const card = Utils.createElement('div', '', 'card');
      card.appendChild(Utils.createElement('h1', 'Offline Room'));
      card.appendChild(Utils.createElement('p', 'Scan QR or copy code to join.'));

      // Generate QR
      const qrDiv = Utils.createElement('div');
      qrDiv.id = 'qrcode';
      card.appendChild(qrDiv);
      setTimeout(() => new QRCode(qrDiv, { text: url, width: 180, height: 180, colorDark : "#000000", colorLight : "#ffffff" }), 100);

      const btnCopy = Utils.createElement('button', 'Copy Text Code', 'secondary');
      btnCopy.onclick = () => { navigator.clipboard.writeText(base64); btnCopy.textContent = "Copied!"; };
      card.appendChild(btnCopy);

      const inputAnswer = Utils.createElement('input');
      inputAnswer.placeholder = "Paste answer code here...";
      inputAnswer.oninput = async (e) => {
        const dec = Utils.decodeBase64Url(e.target.value.trim());
        if(dec) {
          const ans = Protocol.validateSignal(dec, 'answer');
          if(ans) connection.acceptAnswer(ans);
        }
      };
      card.appendChild(inputAnswer);
      
      view.appendChild(card);
      App.container.appendChild(view);
    } catch(e) { App.renderError("Network error."); }
  },

  async handleManualJoin(offerSignal) {
    App.setState(STATE.CONNECTING);
    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      const ansStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      const base64 = Utils.encodeBase64Url(ansStr);
      
      const view = Utils.createElement('div', '', 'view');
      const card = Utils.createElement('div', '', 'card');
      card.appendChild(Utils.createElement('h1', 'Send Answer'));
      card.appendChild(Utils.createElement('p', 'Copy this and send to Host:'));
      
      const txt = Utils.createElement('textarea');
      txt.value = base64; txt.readOnly = true; txt.rows = 4;
      card.appendChild(txt);

      const btnCopy = Utils.createElement('button', 'Copy Answer');
      btnCopy.onclick = () => navigator.clipboard.writeText(base64);
      card.appendChild(btnCopy);
      
      view.appendChild(card);
      App.container.appendChild(view);
    } catch(e) { App.renderError("Invalid offer."); }
  },

  // ================= CHAT UI =================
  
  renderChat() {
    App.setState(STATE.CONNECTED);
    const view = Utils.createElement('div', '', 'view');
    view.style.justifyContent = 'flex-start';
    view.style.height = '100%';

    const log = Utils.createElement('div');
    log.id = 'chat-log';
    log.appendChild(Utils.createElement('div', 'Encrypted P2P connection active.', 'msg system'));
    view.appendChild(log);

    const inputContainer = Utils.createElement('div');
    inputContainer.id = 'chat-input-container';
    
    const fileInput = Utils.createElement('input');
    fileInput.type = 'file'; fileInput.style.display = 'none';
    fileInput.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      App.appendSystemMessage(`Sending ${f.name}... (0%)`, 'upload');
      connection.sendFile(f, (prog) => {
        App.updateSystemMessage('upload', `Sending ${f.name}... (${Math.round(prog * 100)}%)`);
        if (prog === 1) App.updateSystemMessage('upload', `Sent ✅`);
      });
      fileInput.value = '';
    };

    const btnFile = Utils.createElement('button');
    btnFile.id = 'btn-file';
    btnFile.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
    btnFile.onclick = () => fileInput.click();

    const inputField = Utils.createElement('input');
    inputField.placeholder = "Type message...";
    
    const btnSend = Utils.createElement('button');
    btnSend.id = 'btn-send';
    btnSend.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

    const sendMsg = () => {
      const text = inputField.value.trim();
      if (!text) return;
      if (connection && connection.sendMessage(text)) {
        App.appendMessage(text, true);
        inputField.value = '';
      }
    };
    btnSend.onclick = sendMsg;
    inputField.onkeypress = (e) => { if (e.key === 'Enter') sendMsg(); };

    inputContainer.appendChild(fileInput);
    inputContainer.appendChild(btnFile);
    inputContainer.appendChild(inputField);
    inputContainer.appendChild(btnSend);
    view.appendChild(inputContainer);
    App.container.appendChild(view);
  },

  // ================= ROUTER & HELPERS =================
  
  onMessageRouter(msg) {
    if (msg.type === 'chat') App.appendMessage(msg.text, false);
    else if (msg.type === 'file_start') {
      incomingFile = msg; fileChunks = []; fileReceivedBytes = 0;
      App.appendFileBox(msg.name, msg.size, 'download');
    } 
    else if (msg.type === 'file_chunk' && incomingFile) {
      fileChunks.push(msg.data); fileReceivedBytes += msg.data.byteLength;
      App.updateFileBox('download', (fileReceivedBytes / incomingFile.size) * 100);
    } 
    else if (msg.type === 'file_end' && incomingFile) {
      const blob = new Blob(fileChunks);
      const url = URL.createObjectURL(blob);
      App.completeFileBox('download', url);
      incomingFile = null; fileChunks = [];
    }
  },

  appendMessage(text, isSelf) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const msgEl = Utils.createElement('div', text, isSelf ? 'msg self' : 'msg peer');
    log.appendChild(msgEl);
    log.scrollTop = log.scrollHeight;
  },

  appendSystemMessage(text, id) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const msgEl = Utils.createElement('div', text, 'msg system');
    msgEl.id = 'sys-' + id;
    log.appendChild(msgEl);
    log.scrollTop = log.scrollHeight;
  },

  updateSystemMessage(id, text) {
    const el = document.getElementById('sys-' + id);
    if (el) el.textContent = text;
  },

  // Beautiful SVG File UI
  appendFileBox(name, size, id) {
    const log = document.getElementById('chat-log');
    const box = Utils.createElement('div', '', 'file-box msg peer');
    box.id = 'filebox-' + id;
    box.innerHTML = `
      <svg class="file-icon" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
      <div class="file-info">
        <div class="file-name">${name}</div>
        <div class="file-size" id="fileprog-${id}">0%</div>
      </div>
    `;
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  },

  updateFileBox(id, percent) {
    const el = document.getElementById('fileprog-' + id);
    if (el) el.textContent = `Receiving... ${Math.round(percent)}%`;
  },

  completeFileBox(id, url) {
    const el = document.getElementById('fileprog-' + id);
    const box = document.getElementById('filebox-' + id);
    if (el && box) {
      el.textContent = "Ready";
      const a = document.createElement('a');
      a.href = url; a.download = 'download'; a.textContent = 'Save File'; a.style.color = 'var(--primary)';
      a.style.fontSize = '0.8rem'; a.style.fontWeight = 'bold';
      el.innerHTML = ''; el.appendChild(a);
    }
  },

  onConnectionStateChange(status, message = "") {
    if (status === 'CONNECTED') App.renderChat();
    else if (status === 'CLOSED' || status.startsWith('ERR_')) App.renderError(message || "Connection interrupted.");
  },

  renderError(message) {
    App.setState(STATE.ERROR);
    if(connection) connection.destroy();
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.appendChild(Utils.createElement('h1', 'Disconnected'));
    card.appendChild(Utils.createElement('p', message));
    const btnHome = Utils.createElement('button', 'Go Home');
    btnHome.onclick = () => App.renderIdle();
    card.appendChild(btnHome);
    view.appendChild(card);
    App.container.appendChild(view);
  }
};

window.onload = App.init;
