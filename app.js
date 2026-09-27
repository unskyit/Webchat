// app.js - App State, Cloud OTP, Chat UI, Multi-QR (6 Parts) & Dynamic Camera

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 

const STATE = { IDLE: 'IDLE', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED', ERROR: 'ERROR' };
let currentState = STATE.IDLE;
let connection = null;
let incomingFiles = {};
let html5QrCode = null; 

const animHTML = `
  <div class="link-animation">
    <div class="orb"></div>
    <div class="beam-container"><div class="beam"></div></div>
    <div class="orb"></div>
  </div>
`;

function createQRChunks(base64) {
  const chunks = [];
  const TOTAL_CHUNKS = 6;
  const chunkSize = Math.ceil(base64.length / TOTAL_CHUNKS);
  for(let i = 0; i < base64.length; i += chunkSize) {
    chunks.push(base64.substring(i, i + chunkSize));
  }
  return chunks.map((c, i) => `WCT:${i+1}/${chunks.length}:${c}`);
}

function extractCode(text) {
  if (text.includes('#join=')) return text.split('#join=')[1];
  return text.trim();
}

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

  async stopScannerSafely() {
    if (html5QrCode) {
      try { await html5QrCode.stop(); } catch(e) {}
      try { html5QrCode.clear(); } catch(e) {}
      html5QrCode = null;
    }
    const rc = document.getElementById('reader-container');
    if (rc) { rc.style.display = 'none'; rc.innerHTML = ''; }
  },

  setState(newState) { 
    currentState = newState; 
    App.container.innerHTML = ''; 
    App.stopScannerSafely(); 
  },

  renderIdle() {
    App.setState(STATE.IDLE);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">New Session</h1><p>${App.settings.useCloud ? 'Enter a custom PIN to create or join.' : 'Create a room or join one offline.'}</p>`;

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
      const btnJoin = Utils.createElement('button', 'Join Offline Room', 'secondary');
      btnJoin.onclick = () => App.renderScannerUI('offer', (decoded) => {
        const sig = Protocol.validateSignal(Utils.decodeBase64Url(decoded), 'offer');
        if (sig) App.handleManualJoin(sig); 
        else { alert("Invalid Offer Code."); App.renderIdle(); }
      });
      card.appendChild(btnHost); card.appendChild(btnJoin);
    }
    view.appendChild(card); App.container.appendChild(view);
  },

  renderScannerUI(expectedType, onSuccess) {
    App.setState(STATE.CONNECTING);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">Provide Code</h1><p>Paste the full text code, or scan the QR(s).</p>`;

    const instruction = Utils.createElement('div', 'Scan QR Code 1', 'scan-instruction');
    card.appendChild(instruction);

    const camSelect = Utils.createElement('select', '', 'cam-select');
    camSelect.style.display = 'none';
    card.appendChild(camSelect);

    const readerWrapper = Utils.createElement('div');
    readerWrapper.id = 'reader-container';
    readerWrapper.style.display = 'none';
    card.appendChild(readerWrapper);

    const btnGroup = Utils.createElement('div', '', 'scan-btn-group');
    
    let scannedParts = [];
    let expectedParts = 0;

    const handleScan = async (text) => {
       if (text.startsWith('WCT:')) {
          const parts = text.split(':');
          if (parts.length >= 3) {
             const info = parts[1].split('/');
             const index = parseInt(info[0]) - 1;
             expectedParts = parseInt(info[1]);
             if (!scannedParts[index]) {
                scannedParts[index] = parts.slice(2).join(':'); 
             }
             const scannedCount = scannedParts.filter(Boolean).length;
             if (scannedCount === expectedParts) {
                await App.stopScannerSafely();
                instruction.textContent = "All parts scanned! Connecting...";
                onSuccess(scannedParts.join(''));
             } else {
                instruction.textContent = `Scanned ${scannedCount} of ${expectedParts}. Scan another!`;
             }
          }
       } else {
          await App.stopScannerSafely();
          onSuccess(extractCode(text));
       }
    };

    const startCamera = async (deviceId) => {
       await App.stopScannerSafely();
       readerWrapper.style.display = 'block';
       html5QrCode = new Html5Qrcode("reader-container");
       try {
          // FIX: Dynamic qrbox prevents squishing on weird aspect ratios
          await html5QrCode.start(
            deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }, 
            { 
              fps: 10, 
              qrbox: function(vw, vh) { return { width: Math.min(vw, vh) * 0.8, height: Math.min(vw, vh) * 0.8 }; }
            }, 
            handleScan
          );
       } catch(e) { alert("Camera failed to start."); }
    };

    const btnCam = Utils.createElement('button', '📸 Camera', 'secondary');
    btnCam.onclick = async () => {
      btnCam.disabled = true;
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
           camSelect.style.display = 'block';
           camSelect.innerHTML = '';
           devices.forEach(d => {
              const opt = document.createElement('option');
              opt.value = d.id; opt.text = d.label || `Camera ${camSelect.length + 1}`;
              camSelect.appendChild(opt);
           });
           const mainCam = devices.find(d => d.label.toLowerCase().includes('back') && !d.label.toLowerCase().includes('wide'));
           if(mainCam) camSelect.value = mainCam.id;
           camSelect.onchange = () => startCamera(camSelect.value);
           startCamera(camSelect.value);
        } else { alert("No cameras found."); }
      } catch(e) { alert("Camera permission denied."); }
      btnCam.disabled = false;
    };

    const fileIn = Utils.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.style.display = 'none';
    const btnFile = Utils.createElement('button', '🖼️ Upload', 'secondary');
    btnFile.onclick = () => fileIn.click();
    fileIn.onchange = (e) => {
      if(!e.target.files.length) return;
      if(!html5QrCode) html5QrCode = new Html5Qrcode("reader-container");
      html5QrCode.scanFile(e.target.files[0], true)
        .then(text => handleScan(text))
        .catch(err => alert("No QR found in image."));
      fileIn.value = '';
    };

    btnGroup.appendChild(btnCam); btnGroup.appendChild(btnFile); btnGroup.appendChild(fileIn);
    card.appendChild(btnGroup);

    const inputArea = Utils.createElement('textarea'); inputArea.placeholder = "Or paste full text code here..."; inputArea.rows = 2;
    const btnSubmit = Utils.createElement('button', 'Submit Code');
    btnSubmit.onclick = async () => { 
      if(inputArea.value.trim()) { 
        await App.stopScannerSafely();
        onSuccess(extractCode(inputArea.value)); 
      } 
    };

    card.appendChild(inputArea); card.appendChild(btnSubmit);
    
    const btnBack = Utils.createElement('button', 'Cancel', 'secondary');
    btnBack.style.marginTop = '10px'; btnBack.onclick = () => App.renderIdle();
    card.appendChild(btnBack);

    view.appendChild(card); App.container.appendChild(view);
  },

  renderQRCarousel(container, base64Payload) {
    const chunks = createQRChunks(base64Payload);
    let currentIndex = 0;

    const qrWrap = Utils.createElement('div');
    const qrDiv = Utils.createElement('div'); qrDiv.id = 'qrcode'; 
    qrWrap.appendChild(qrDiv);

    const navWrap = Utils.createElement('div', '', 'qr-carousel');
    const btnPrev = Utils.createElement('button', '❮', 'secondary qr-nav-btn');
    const btnNext = Utils.createElement('button', '❯', 'secondary qr-nav-btn');
    const lblStatus = Utils.createElement('span', `QR 1 of ${chunks.length}`, 'qr-status');
    
    navWrap.appendChild(btnPrev); navWrap.appendChild(lblStatus); navWrap.appendChild(btnNext);
    if(chunks.length > 1) qrWrap.appendChild(navWrap);
    container.appendChild(qrWrap);

    const updateQR = () => {
      qrDiv.innerHTML = '';
      new QRCode(qrDiv, { text: chunks[currentIndex], width: 250, height: 250, colorDark : "#000000", colorLight : "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      lblStatus.textContent = `QR ${currentIndex + 1} of ${chunks.length}`;
      btnPrev.disabled = currentIndex === 0;
      btnNext.disabled = currentIndex === chunks.length - 1;
    };
    
    btnPrev.onclick = () => { if(currentIndex > 0) { currentIndex--; updateQR(); }};
    btnNext.onclick = () => { if(currentIndex < chunks.length - 1) { currentIndex++; updateQR(); }};
    
    setTimeout(updateQR, 100);
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
        card.innerHTML = '<h1 class="brand">Offline Room</h1><p>Step 1: Share this QR or Code</p>';
        
        App.renderQRCarousel(card, base64); 

        setTimeout(() => {
          const btnCopy = Utils.createElement('button', '📋 Copy Full Text Code', 'secondary');
          btnCopy.onclick = () => { navigator.clipboard.writeText(base64); btnCopy.textContent = "Copied!"; setTimeout(() => btnCopy.textContent = "📋 Copy Full Text Code", 2000); };
          card.appendChild(btnCopy);

          card.appendChild(Utils.createElement('p', 'Step 2: Receive their Answer'));
          const btnScanAns = Utils.createElement('button', 'Provide Answer Code');
          btnScanAns.onclick = () => App.renderScannerUI('answer', (decoded) => {
             const ans = Protocol.validateSignal(Utils.decodeBase64Url(decoded), 'answer');
             if(ans) { App.setState(STATE.CONNECTING); connection.acceptAnswer(ans); }
             else { alert("Invalid Answer Code."); App.renderIdle(); } 
          });
          card.appendChild(btnScanAns);
        }, 200);
      } catch(e) { App.renderError("Network error."); }
    }, 100);
  },

  async handleManualJoin(offerSignal) {
    App.setState(STATE.CONNECTING);
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Generating...</h1><p>Securing response keys (please wait)...</p>${animHTML}`;
    view.appendChild(card); App.container.appendChild(view);

    setTimeout(async () => {
      connection = new P2PConnection(App.onConnectionStateChange, App.onMessageRouter);
      try {
        const ansStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
        const base64 = Utils.encodeBase64Url(ansStr);
        card.innerHTML = '<h1 class="brand">Send Answer</h1><p>Share this back to the Host:</p>';
        
        App.renderQRCarousel(card, base64);

        setTimeout(() => {
          const btnCopy = Utils.createElement('button', '📋 Copy Full Text Code', 'secondary');
          btnCopy.onclick = () => { navigator.clipboard.writeText(base64); btnCopy.textContent = "Copied!"; setTimeout(() => btnCopy.textContent = "📋 Copy Full Text Code", 2000); };
          card.appendChild(btnCopy);
        }, 200);
      } catch(e) { App.renderError("Invalid offer."); }
    }, 100);
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
      } else { text.textContent = 'Sent ✅'; }
    }
  },

  onConnectionStateChange(status, message = "") {
    if (status === 'CONNECTED') App.renderChat();
    else if (status === 'CLOSED' || status.startsWith('ERR_')) {
      if (currentState === STATE.CONNECTED) {
        App.appendSystemMessage(`⚠️ ${message} The room is now closed.`, 'disconnect');
        const inputCont = document.getElementById('chat-input-container');
        if (inputCont) { inputCont.style.opacity = '0.5'; inputCont.style.pointerEvents = 'none'; }
      } else { App.renderError(message || "Connection interrupted."); }
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
