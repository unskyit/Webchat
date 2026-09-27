// app.js - App State, Settings, Cloud OTP, and Chat UI

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 

const STATE = { IDLE: 'IDLE', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED', ERROR: 'ERROR' };
let currentState = STATE.IDLE;
let connection = null;
let incomingFiles = {};

const animHTML = `
  <div class="link-animation">
    <div class="orb"></div>
    <div class="beam-container"><div class="beam"></div></div>
    <div class="orb"></div>
  </div>
`;

const App = {
  container: document.getElementById('app-container'),
  settings: { darkMode: false, useCloud: true },

  init() {
    document.getElementById('btn-settings').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-overlay').classList.add('hidden');
    
    document.getElementById('toggle-theme').onchange = (e) => {
      App.settings.darkMode = e.target.checked;
      document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode';
    };
    
    document.getElementById('toggle-mode').onchange = (e) => {
      App.settings.useCloud = e.target.checked;
      document.getElementById('mode-desc').textContent = App.settings.useCloud ? "Cloud OTP (Requires Internet)" : "Manual/QR (Works Offline)";
      App.renderIdle(); 
    };

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
      const inputOTP = Utils.createElement('input', '', 'otp-input');
      inputOTP.placeholder = "e.g. secret45"; inputOTP.maxLength = 15;
      const btnHost = Utils.createElement('button', 'Create with PIN');
      btnHost.onclick = () => { if(inputOTP.value.trim()) App.hostCloudRoom(inputOTP.value.trim().toLowerCase()); };
      const btnJoin = Utils.createElement('button', 'Join with PIN', 'secondary');
      btnJoin.onclick = () => { if(inputOTP.value.trim()) App.joinCloudRoom(inputOTP.value.trim().toLowerCase()); };
      card.appendChild(inputOTP); card.appendChild(btnHost); card.appendChild(btnJoin);
    } else {
      const btnHost = Utils.createElement('button', 'Create Offline Room');
      btnHost.onclick = () => App.hostManualRoom();
      const btnJoin = Utils.createElement('button', 'Paste Connection Code', 'secondary');
      btnJoin.onclick = () => {
        const code = prompt("Paste code here:");
        if (code) {
          const sig = Protocol.validateSignal(Utils.decodeBase64Url(code), 'offer');
          if (sig) App.handleManualJoin(sig);
          else alert("Invalid code.");
        }
      };
      card.appendChild(btnHost); card.appendChild(btnJoin);
    }
    view.appendChild(card); App.container.appendChild(view);
  },

  async hostCloudRoom(pin) {
    App.setState(STATE.CONNECTING);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">Room Created</h1><p>Tell your friend to enter PIN:</p><h2 class="otp-input">${pin}</h2>${animHTML}<p style="margin-top:10px; font-size:0.85rem;">Waiting for them to join... (Expires in 5m)</p>`;
    view.appendChild(card); App.container.appendChild(view);
    
    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      const offerStr = await connection.generateOffer();
      await fetch(APP_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ room: pin, type: 'offer', payload: offerStr }) });
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
    card.innerHTML = `<h1>Connecting...</h1><p>Looking for PIN: ${pin}</p>${animHTML}`;
    view.appendChild(card); App.container.appendChild(view);
    
    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_offer`);
      const data = await res.json();
      if (!data.payload) throw new Error("Room not found or expired.");
      const offerSignal = Protocol.validateSignal(data.payload, 'offer');
      const answerStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      await fetch(APP_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ room: pin, type: 'answer', payload: answerStr }) });
      card.innerHTML = `<h1 class="brand">Securing P2P Link...</h1><p>Establishing direct connection...</p>${animHTML}`;
    } catch(e) { App.renderError(e.message); }
  },

  async hostManualRoom() {
    App.setState(STATE.CONNECTING);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Generating...</h1><p>Securing encryption keys (please wait)...</p>${animHTML}`;
    view.appendChild(card); App.container.appendChild(view);

    setTimeout(async () => {
      connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
      try {
        const offerStr = await connection.generateOffer();
        const base64 = Utils.encodeBase64Url(offerStr);
        const url = `${window.location.origin}${window.location.pathname}#join=${base64}`;

        card.innerHTML = '<h1 class="brand">Offline Room</h1><p>Scan QR or copy code to join.</p>';
        const qrDiv = Utils.createElement('div'); qrDiv.id = 'qrcode'; card.appendChild(qrDiv);
        
        // FIX: Increased to 320x320. Massive matrices need a larger physical render to be legible by cameras.
        new QRCode(qrDiv, { text: url, width: 320, height: 320, colorDark : "#000000", colorLight : "#ffffff", correctLevel: QRCode.CorrectLevel.L });

        setTimeout(() => {
          const canvas = document.querySelector('#qrcode canvas');
          if (canvas) {
            const btnDl = Utils.createElement('button', '💾 Save QR Image', 'secondary');
            btnDl.onclick = () => { const link = document.createElement('a'); link.download = 'Webchat-Room.png'; link.href = canvas.toDataURL("image/png"); link.click(); };
            card.appendChild(btnDl);
          }
          const btnCopy = Utils.createElement('button', 'Copy Text Code', 'secondary');
          btnCopy.onclick = () => { navigator.clipboard.writeText(base64); btnCopy.textContent = "Copied!"; setTimeout(() => btnCopy.textContent = "Copy Text Code", 2000); };
          card.appendChild(btnCopy);

          const inputAnswer = Utils.createElement('input'); inputAnswer.placeholder = "Paste friend's answer here...";
          inputAnswer.oninput = async (e) => {
            const dec = Utils.decodeBase64Url(e.target.value.trim());
            if(dec) {
              const ans = Protocol.validateSignal(dec, 'answer');
              if(ans) { inputAnswer.value = 'Connecting...'; inputAnswer.disabled = true; connection.acceptAnswer(ans); }
            }
          };
          card.appendChild(inputAnswer);
        }, 300);
      } catch(e) { App.renderError("Network error."); }
    }, 100);
  },

  async handleManualJoin(offerSignal) {
    App.setState(STATE.CONNECTING);
    connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
    try {
      const ansStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      const base64 = Utils.encodeBase64Url(ansStr);
      const view = Utils.createElement('div', '', 'view');
      const card = Utils.createElement('div', '', 'card');
      card.innerHTML = '<h1 class="brand">Send Answer</h1><p>Copy this and send to Host:</p>';
      const txt = Utils.createElement('textarea'); txt.value = base64; txt.readOnly = true; txt.rows = 4;
      card.appendChild(txt);
      const btnCopy = Utils.createElement('button', 'Copy Answer');
      btnCopy.onclick = () => { navigator.clipboard.writeText(base64); btnCopy.textContent = "Copied!"; };
      card.appendChild(btnCopy); view.appendChild(card); App.container.appendChild(view);
    } catch(e) { App.renderError("Invalid offer."); }
  },

  renderChat() {
    App.setState(STATE.CONNECTED);
    const view = Utils.createElement('div', '', 'view');
    view.style.justifyContent = 'flex-start'; view.style.height = '100%';

    const chatHeader = Utils.createElement('div'); chatHeader.id = 'chat-header-bar';
    chatHeader.innerHTML = '<h3 class="brand">Live Session</h3>';
    const btnEnd = Utils.createElement('button', 'End Chat'); btnEnd.id = 'btn-end';
    btnEnd.onclick = () => { if(connection) connection.destroy(); App.renderIdle(); };
    chatHeader.appendChild(btnEnd); view.appendChild(chatHeader);

    const log = Utils.createElement('div'); log.id = 'chat-log';
    log.appendChild(Utils.createElement('div', 'Encrypted P2P connection active.', 'msg system'));
    view.appendChild(log);

    const inputContainer = Utils.createElement('div'); inputContainer.id = 'chat-input-container';
    
    const fileInput = Utils.createElement('input'); fileInput.type = 'file'; fileInput.style.display = 'none';
    let isSendingFile = false;

    fileInput.onchange = (e) => {
      const f = e.target.files[0]; 
      if (!f || isSendingFile) return;
      isSendingFile = true;
      const fileId = 'upload-' + Utils.generateId();
      App.appendFileBox(f.name, f.size, fileId, true);
      
      connection.sendFile(f, (prog) => {
        App.updateFileBox(fileId, prog * 100);
      }, () => {
        App.completeFileBox(fileId, null, null);
        isSendingFile = false;
      });
      fileInput.value = '';
    };

    const btnFile = Utils.createElement('button'); btnFile.id = 'btn-file';
    btnFile.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
    btnFile.onclick = () => fileInput.click();

    const inputField = Utils.createElement('input'); inputField.placeholder = "Type message...";
    const btnSend = Utils.createElement('button'); btnSend.id = 'btn-send';
    btnSend.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

    const sendMsg = () => {
      const text = inputField.value.trim(); if (!text) return;
      if (connection && connection.sendMessage(text)) { App.appendMessage(text, true); inputField.value = ''; }
    };
    btnSend.onclick = sendMsg; inputField.onkeypress = (e) => { if (e.key === 'Enter') sendMsg(); };

    inputContainer.appendChild(fileInput); inputContainer.appendChild(btnFile); inputContainer.appendChild(inputField); inputContainer.appendChild(btnSend);
    view.appendChild(inputContainer); App.container.appendChild(view);
    setTimeout(() => inputField.focus(), 100);
  },

  onMessageRouter(msg) {
    if (msg.type === 'chat') App.appendMessage(msg.text, false);
    else if (msg.type === 'file_start') {
      incomingFiles[msg.id] = { name: msg.name, size: msg.size, mimeType: msg.mimeType, chunks: [], receivedBytes: 0 };
      App.appendFileBox(msg.name, msg.size, msg.id, false);
    } 
    else if (msg.type === 'file_chunk') {
      const activeFileId = Object.keys(incomingFiles)[0];
      if (activeFileId) {
         const activeFile = incomingFiles[activeFileId];
         activeFile.chunks.push(msg.data); 
         activeFile.receivedBytes += msg.data.byteLength;
         App.updateFileBox(activeFileId, (activeFile.receivedBytes / activeFile.size) * 100);
      }
    } 
    else if (msg.type === 'file_end') {
      const activeFile = incomingFiles[msg.id];
      if (activeFile) {
         const blob = new Blob(activeFile.chunks, { type: activeFile.mimeType || 'application/octet-stream' }); 
         const url = URL.createObjectURL(blob);
         App.completeFileBox(msg.id, url, activeFile.name);
         delete incomingFiles[msg.id];
      }
    }
  },

  appendMessage(text, isSelf) {
    const log = document.getElementById('chat-log'); if (!log) return;
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const wrap = Utils.createElement('div', '', isSelf ? 'msg-wrap self' : 'msg-wrap peer');
    const bubble = Utils.createElement('div', text, 'msg-bubble');
    const timeEl = Utils.createElement('div', time, 'msg-time');
    wrap.appendChild(bubble); wrap.appendChild(timeEl); log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  },

  appendSystemMessage(text, id) {
    const log = document.getElementById('chat-log'); if (!log) return;
    const msgEl = Utils.createElement('div', text, 'msg system'); msgEl.id = 'sys-' + id;
    log.appendChild(msgEl); log.scrollTop = log.scrollHeight;
  },

  appendFileBox(name, size, id, isUpload) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', 'msg-wrap ' + (isUpload ? 'self' : 'peer'));
    const box = Utils.createElement('div', '', 'file-box');
    box.id = 'filebox-' + id;
    box.innerHTML = `
      <svg class="file-icon" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
      <div class="file-info">
        <div class="file-name">${name}</div>
        <div class="file-size" id="fileprog-text-${id}">0%</div>
        <div class="progress-bar"><div class="progress-fill" id="fileprog-bar-${id}" style="width: 0%"></div></div>
      </div>`;
    wrap.appendChild(box);
    wrap.appendChild(Utils.createElement('div', new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), 'msg-time'));
    log.appendChild(wrap); log.scrollTop = log.scrollHeight;
  },

  updateFileBox(id, percent) {
    const text = document.getElementById('fileprog-text-' + id);
    const bar = document.getElementById('fileprog-bar-' + id);
    const p = Math.floor(percent);
    if (text) text.textContent = `Transferring... ${p}%`;
    if (bar) bar.style.width = `${p}%`;
  },

  completeFileBox(id, url, filename) {
    const text = document.getElementById('fileprog-text-' + id);
    const bar = document.getElementById('fileprog-bar-' + id);
    if (bar) bar.style.width = `100%`;
    if (text) {
      if (url) {
        text.innerHTML = '';
        const a = document.createElement('a'); 
        a.href = url; a.download = filename; a.textContent = '💾 Save File'; 
        a.className = 'download-link';
        text.appendChild(a);
      } else {
        text.textContent = 'Sent ✅';
      }
    }
  },

  onConnectionStateChange(status, message = "") {
    if (status === 'CONNECTED') App.renderChat();
    else if (status === 'CLOSED' || status.startsWith('ERR_')) {
      if (currentState === STATE.CONNECTED) {
        App.appendSystemMessage(`⚠️ ${message} The room is now closed.`, 'disconnect');
        const inputCont = document.getElementById('chat-input-container');
        if (inputCont) { inputCont.style.opacity = '0.5'; inputCont.style.pointerEvents = 'none'; }
      } else {
        App.renderError(message || "Connection interrupted.");
      }
    }
  },

  renderError(message) {
    App.setState(STATE.ERROR);
    if(connection) connection.destroy();
    const view = Utils.createElement('div', '', 'view'); const card = Utils.createElement('div', '', 'card');
    card.appendChild(Utils.createElement('h1', 'Disconnected')); card.appendChild(Utils.createElement('p', message));
    const btnHome = Utils.createElement('button', 'Go Home'); btnHome.onclick = () => App.renderIdle();
    card.appendChild(btnHome); view.appendChild(card); App.container.appendChild(view);
  }
};

window.onload = App.init;
