// app.js - Controller, Event Routing & UI Lifecycle

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 
let connection = null;
let html5QrCode = null;
let deferredPrompt = null;
let activeReplyMsg = null;
let qrFlashInterval = null;

const animHTML = `
  <div class="link-animation">
    <div class="orb"></div>
    <div class="beam-container"><div class="beam"></div></div>
    <div class="orb"></div>
  </div>
`;

const KeepAlive = {
  audio: null,
  init() {
    if(!this.audio) {
      this.audio = document.createElement('audio');
      this.audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'; 
      this.audio.loop = true;
    }
    this.audio.play().then(() => this.audio.pause()).catch(e=>{});
  },
  start() { if(this.audio) this.audio.play().catch(e=>{}); },
  stop() { if(this.audio) this.audio.pause(); }
};

function createQRChunks(base64) {
  const TOTAL_CHUNKS = App.settings.qrChunks; 
  const chunkSize = Math.ceil(base64.length / TOTAL_CHUNKS);
  const chunks = [];
  for(let i = 0; i < base64.length; i += chunkSize) chunks.push(base64.substring(i, i + chunkSize));
  if (TOTAL_CHUNKS === 1) return [`WCT:1/1:${base64}`]; 
  return chunks.map((c, i) => `WCT:${i+1}/${chunks.length}:${c}`);
}

function extractCode(text) {
  if (text.includes('#join=')) return text.split('#join=')[1];
  return text.trim();
}

const Synthesizer = {
  ctx: null,
  init() { if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
  playPop() {
    if(!this.ctx || !App.settings.sound) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, t); osc.frequency.exponentialRampToValueAtTime(400, t + 0.07);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.15, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
    osc.start(t); osc.stop(t + 0.1);
  },
  playSwoosh() {
    if(!this.ctx || !App.settings.sound) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(650, t);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.15, t + 0.02); gain.gain.linearRampToValueAtTime(0, t + 0.08);
    osc.frequency.setValueAtTime(850, t + 0.09); gain.gain.setValueAtTime(0, t + 0.09); gain.gain.linearRampToValueAtTime(0.15, t + 0.11); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.start(t); osc.stop(t + 0.35);
  }
};

const App = {
  container: document.getElementById('app-container'),
  settings: { darkMode: false, useCloud: true, qrChunks: 15, ghostTyping: false, sound: true },
  sessionTimer: null, sessionStartTime: 0,
  metricsInterval: null, lastMetrics: { rxBytes: 0, txBytes: 0 },
  activeIncomingFile: null, activeBatches: {},
  isScrolledUp: false, unreadCount: 0,

  saveSettings() {
    localStorage.setItem('wchat_settings', JSON.stringify(this.settings));
  },

  loadSettings() {
    const saved = JSON.parse(localStorage.getItem('wchat_settings') || '{}');
    this.settings = { ...this.settings, ...saved };
    
    const themeToggle = document.getElementById('toggle-theme');
    if (themeToggle) themeToggle.checked = this.settings.darkMode;
    
    const soundToggle = document.getElementById('toggle-sound');
    if (soundToggle) soundToggle.checked = this.settings.sound;
    
    const ghostToggle = document.getElementById('toggle-ghost');
    if (ghostToggle) ghostToggle.checked = this.settings.ghostTyping;
    
    const modeToggle = document.getElementById('toggle-mode');
    if (modeToggle) modeToggle.checked = this.settings.useCloud;
    
    document.body.className = this.settings.darkMode ? 'dark-mode' : 'light-mode'; 
    const meta = document.getElementById('meta-theme-color');
    if (meta) meta.setAttribute("content", this.settings.darkMode ? "#000000" : "#f0f4f8");
    
    const modeDesc = document.getElementById('mode-desc');
    if (modeDesc) modeDesc.textContent = this.settings.useCloud ? "Cloud OTP" : "Manual/QR";
  },

  init() {
    this.loadSettings();

    window.addEventListener('beforeunload', (e) => {
      if (connection) { e.preventDefault(); e.returnValue = ''; }
    });

    window.addEventListener('popstate', (e) => {
      if (connection) {
         history.pushState({ view: 'CONNECTED' }, '', '#CONNECTED');
         App.showAlert("Please end the chat using the 'End Chat' button to safely disconnect.", "Action Blocked");
         return;
      }
      if (e.state && e.state.view) App.renderState(e.state.view, false);
      else App.renderState('IDLE', false);
    });

    document.getElementById('btn-close-settings').onclick = () => {
      document.getElementById('settings-overlay').classList.add('hidden');
    };
    
    document.getElementById('toggle-theme').onchange = (e) => { 
      App.settings.darkMode = e.target.checked; App.saveSettings();
      document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode'; 
      const meta = document.getElementById('meta-theme-color');
      if (meta) meta.setAttribute("content", App.settings.darkMode ? "#000000" : "#f0f4f8");
    };
    
    document.getElementById('toggle-sound').onchange = (e) => { App.settings.sound = e.target.checked; App.saveSettings(); };
    document.getElementById('toggle-ghost').onchange = (e) => { App.settings.ghostTyping = e.target.checked; App.saveSettings(); };
    document.getElementById('toggle-mode').onchange = (e) => {
      App.settings.useCloud = e.target.checked; App.saveSettings();
      document.getElementById('mode-desc').textContent = App.settings.useCloud ? "Cloud OTP" : "Manual/QR";
      App.renderState('IDLE', true);
    };

    const qrSlider = document.getElementById('qr-slider');
    if (qrSlider) {
      qrSlider.oninput = (e) => {
        App.settings.qrChunks = parseInt(e.target.value);
        document.getElementById('qr-slider-val').textContent = App.settings.qrChunks;
      };
    }

    const btnInstall = document.getElementById('btn-install-pwa');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e; btnInstall.classList.remove('hidden');
    });
    btnInstall.addEventListener('click', async () => {
      if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; btnInstall.classList.add('hidden'); }
    });

    let savedUsage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
    document.getElementById('data-counter').textContent = `${(savedUsage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(savedUsage.down/(1024*1024)).toFixed(2)} MB ⬇`;

    document.addEventListener('click', (e) => {
      const ctxMenu = document.getElementById('context-menu');
      if (!ctxMenu.classList.contains('hidden') && !ctxMenu.contains(e.target)) {
        ctxMenu.classList.add('hidden');
      }
    });

    document.addEventListener('pointerdown', () => KeepAlive.init(), { once: true });

    App.renderState('IDLE', true);
  },

  showAlert(text, title = "Notice") {
    const titleEl = document.getElementById('custom-alert-title');
    const textEl = document.getElementById('custom-alert-text');
    const overlay = document.getElementById('custom-alert-overlay');
    if (overlay && titleEl && textEl) {
        titleEl.textContent = title; textEl.textContent = text;
        overlay.classList.remove('hidden');
        document.getElementById('custom-alert-btn').onclick = () => overlay.classList.add('hidden');
    }
  },

  showConfirm(title, text, onConfirm, onCancel) {
    const titleEl = document.getElementById('custom-confirm-title');
    const textEl = document.getElementById('custom-confirm-text');
    const overlay = document.getElementById('custom-confirm-overlay');
    if (overlay && titleEl && textEl) {
        titleEl.textContent = title; textEl.textContent = text;
        overlay.classList.remove('hidden');
        
        document.getElementById('custom-confirm-cancel').onclick = () => {
           overlay.classList.add('hidden');
           if(onCancel) onCancel();
        };
        document.getElementById('custom-confirm-ok').onclick = () => {
           overlay.classList.add('hidden');
           if(onConfirm) onConfirm();
        };
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

  renderState(state, pushHistory = true) {
    if (pushHistory) history.pushState({ view: state }, '', `#${state}`);
    App.container.innerHTML = ''; 
    App.stopScannerSafely();
    clearInterval(qrFlashInterval);
    
    document.getElementById('setting-row-mode').style.display = (state === 'CONNECTED') ? 'none' : 'flex';
    document.getElementById('setting-row-battery').style.display = 'none';
    document.getElementById('peer-warn-banner').classList.add('hidden');

    const headerActions = document.getElementById('header-actions');
    if (state === 'IDLE') {
      if(window.DrawController) DrawController.clear(false); 
      KeepAlive.stop();
      headerActions.innerHTML = `<button id="btn-settings-head" class="icon-btn" title="Settings"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>`;
      document.getElementById('btn-settings-head').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
      App.buildIdleView();
    }
    else if (state === 'CONNECTED') {
      KeepAlive.start(); 
      headerActions.innerHTML = `<button id="btn-end-head" class="btn-danger" style="padding: 6px 12px; margin: 0; width: auto; font-size: 0.9rem;">End Chat</button>`;
      
      document.getElementById('btn-end-head').onclick = () => { 
        if(!connection) return;
        connection.sendPayload(JSON.stringify({v: Protocol.VERSION, type: Protocol.TYPES.WARN_DISCONNECT}));
        App.showConfirm("Disconnect?", "Are you sure you want to end this chat?", () => {
            connection.destroy();
            App.renderState('IDLE');
        }, () => {
            connection.sendPayload(JSON.stringify({v: Protocol.VERSION, type: Protocol.TYPES.CANCEL_DISCONNECT}));
        });
      };
      
      App.buildChatView();
    }
  },

  updateStatusText(txt) {
    const el = document.getElementById('loading-status');
    if(el) el.textContent = txt;
  },

  buildIdleView() {
    const view = Utils.createElement('div', '', 'view idle-view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">New Session</h1><p>${App.settings.useCloud ? 'Enter a PIN to connect.' : 'Create an offline room.'}</p>`;

    if (App.settings.useCloud) {
      const inputOTP = Utils.createElement('input', '', 'otp-input'); inputOTP.placeholder = "e.g. secret45";
      const btnHost = Utils.createElement('button', 'Create Room'); btnHost.onclick = () => { if(inputOTP.value) App.hostCloudRoom(inputOTP.value.trim().toLowerCase()); };
      const btnJoin = Utils.createElement('button', 'Join Room', 'secondary'); btnJoin.onclick = () => { if(inputOTP.value) App.joinCloudRoom(inputOTP.value.trim().toLowerCase()); };
      card.appendChild(inputOTP); card.appendChild(btnHost); card.appendChild(btnJoin);
    } else {
      const btnHost = Utils.createElement('button', 'Create Offline Room'); btnHost.onclick = () => App.hostManualRoom();
      const btnJoin = Utils.createElement('button', 'Join Offline Room', 'secondary');
      btnJoin.onclick = () => App.renderScannerUI('offer', (decoded) => {
        const sig = Protocol.validateSignal(Utils.decodeBase64Url(decoded), 'offer');
        if (sig) App.handleManualJoin(sig); else { App.showAlert("Invalid Offer Code.", "Scan Failed"); App.renderState('IDLE'); }
      });
      card.appendChild(btnHost); card.appendChild(btnJoin);
    }
    view.appendChild(card); App.container.appendChild(view);
  },

  renderScannerUI(expectedType, onSuccess) {
    const view = Utils.createElement('div', '', 'view idle-view');
    const card = Utils.createElement('div', '', 'card');
    
    card.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; margin-bottom:15px; gap: 10px;">
                        <h1 class="brand" style="margin:0;">Scan QR</h1>
                        <button id="btn-switch-cam" class="pill-btn hidden">🔄 Switch Lens</button>
                      </div><p>Point camera at the flashing stream.</p>`;
    
    const instruction = Utils.createElement('div', 'Awaiting stream...', 'scan-instruction');
    const readerWrapper = Utils.createElement('div'); readerWrapper.id = 'reader-container'; readerWrapper.style.display = 'none';
    card.appendChild(instruction); card.appendChild(readerWrapper);

    let scannedParts = []; let expectedParts = 0;
    const handleScan = async (text) => {
       if (text.startsWith('WCT:')) {
          const parts = text.split(':');
          if (parts.length >= 3) {
             const info = parts[1].split('/');
             const index = parseInt(info[0]) - 1; expectedParts = parseInt(info[1]);
             if (!scannedParts[index]) {
                scannedParts[index] = parts.slice(2).join(':'); 
                const scannedCount = scannedParts.filter(Boolean).length;
                if (scannedCount === expectedParts) { await App.stopScannerSafely(); instruction.textContent = "Connecting..."; onSuccess(scannedParts.join('')); } 
                else { instruction.textContent = `Captured ${scannedCount}/${expectedParts}... Keep steady.`; }
             }
          }
       } else { await App.stopScannerSafely(); onSuccess(extractCode(text)); }
    };

    let cameras = []; let currentCamIndex = 0;
    const btnSwitchCam = card.querySelector('#btn-switch-cam');
    
    const startCam = async () => {
       await App.stopScannerSafely(); readerWrapper.style.display = 'block';
       html5QrCode = new Html5Qrcode("reader-container");
       try {
         const devices = await Html5Qrcode.getCameras();
         if(devices && devices.length > 0) {
            cameras = devices; 
            if(cameras.length > 1) btnSwitchCam.classList.remove('hidden');
            const config = { fps: 15, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.8, height: Math.min(vw, vh) * 0.8 }) };
            await html5QrCode.start(cameras[currentCamIndex].id, config, handleScan);
         }
       } catch(e) { App.showAlert("Camera failed to load.", "Error"); }
    };

    btnSwitchCam.onclick = () => {
      if(cameras.length > 1) { currentCamIndex = (currentCamIndex + 1) % cameras.length; startCam(); }
    };

    const btnCam = Utils.createElement('button', '📸 Open Camera', 'secondary'); btnCam.onclick = () => startCam();
    const btnBack = Utils.createElement('button', 'Cancel', 'secondary'); btnBack.onclick = () => App.renderState('IDLE');
    
    card.appendChild(btnCam); card.appendChild(btnBack);
    view.appendChild(card); App.container.innerHTML = ''; App.container.appendChild(view);
  },

  renderQRCarousel(container, base64Payload) {
    const chunks = createQRChunks(base64Payload); 
    let currentIndex = 0;
    let isPaused = false;
    
    const qrWrap = Utils.createElement('div', '', 'qr-wrapper'); 
    const qrBox = Utils.createElement('div', '', 'qr-box'); 
    const qrDiv = Utils.createElement('div'); qrDiv.id = 'qrcode'; 
    qrBox.appendChild(qrDiv); qrWrap.appendChild(qrBox);
    
    const lblStatus = Utils.createElement('span', `Streaming...`, 'qr-status mt-10');
    lblStatus.style.fontWeight = 'bold'; lblStatus.style.color = 'var(--text-sub)';
    qrWrap.appendChild(lblStatus);

    const updateQR = () => {
      if(isPaused) return;
      qrDiv.innerHTML = '';
      new QRCode(qrDiv, { text: chunks[currentIndex], width: 220, height: 220, colorDark : "#000000", colorLight : "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      lblStatus.textContent = `Streaming Chunk ${currentIndex + 1} of ${chunks.length}`;
      currentIndex = (currentIndex + 1) % chunks.length;
    };

    qrBox.onclick = () => {
      isPaused = !isPaused;
      lblStatus.textContent = isPaused ? `Paused on Chunk ${currentIndex || chunks.length} (Tap to resume)` : `Streaming...`;
    };

    if(chunks.length > 1) {
      updateQR();
      qrFlashInterval = setInterval(updateQR, 400);
    } else { setTimeout(() => new QRCode(qrDiv, { text: chunks[0], width: 220, height: 220, colorDark : "#000000", colorLight : "#ffffff", correctLevel: QRCode.CorrectLevel.L }), 100); }
    
    container.appendChild(qrWrap);
  },

  async hostCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Room Created</h1><h2 class="otp-input">${pin}</h2>${animHTML}<p id="loading-status">Waiting for friend...</p>`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const offerStr = await connection.generateOffer();
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'offer', payload: offerStr }) });
      
      let polling = true;
      const poll = setInterval(async () => {
        if(!polling) return;
        try {
          const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_answer`);
          const data = await res.json();
          if (data.payload && polling) { 
            polling = false;
            clearInterval(poll); 
            App.updateStatusText("Securing connection...");
            const answerSignal = Protocol.validateSignal(data.payload, 'answer'); 
            if (answerSignal) connection.acceptAnswer(answerSignal); 
          }
        } catch(e) {}
      }, 1500); 
    } catch(e) { App.showAlert("Network failed. Ensure you are connected to the internet.", "Network Error"); App.renderState('IDLE'); }
  },

  async joinCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Connecting...</h1><p>PIN: ${pin}</p>${animHTML}<p id="loading-status">Finding room...</p>`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_offer`);
      const data = await res.json();
      if (!data.payload) throw new Error("Room not found.");
      
      const offerSignal = Protocol.validateSignal(data.payload, 'offer');
      if (!offerSignal) throw new Error("Room offer has expired or is invalid.");

      App.updateStatusText("Securing connection...");
      const answerStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'answer', payload: answerStr }) });
    } catch(e) { App.showAlert(e.message, "Join Failed"); App.renderState('IDLE'); }
  },

  async hostManualRoom() {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Generating Keys...</h1>${animHTML}`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);

    setTimeout(async () => {
      connection = new P2PConnection(App);
      const offerStr = await connection.generateOffer();
      const base64 = Utils.encodeBase64Url(offerStr);
      card.innerHTML = '<h1 class="brand">Offline Room</h1><p>Hold scanner steady to capture the stream</p>';
      App.renderQRCarousel(card, base64);
      setTimeout(() => {
        const btnScan = Utils.createElement('button', 'Provide Answer Code');
        btnScan.onclick = () => App.renderScannerUI('answer', (decoded) => {
           const ans = Protocol.validateSignal(Utils.decodeBase64Url(decoded), 'answer');
           if(ans) connection.acceptAnswer(ans); else { App.showAlert("Invalid code scanned.", "Error"); App.renderState('IDLE'); } 
        });
        card.appendChild(btnScan);
      }, 200);
    }, 100);
  },

  async handleManualJoin(offerSignal) {
    if(!offerSignal) return;
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Securing...</h1>${animHTML}`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);

    setTimeout(async () => {
      connection = new P2PConnection(App);
      const ansStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      const base64 = Utils.encodeBase64Url(ansStr);
      card.innerHTML = '<h1 class="brand">Send Answer</h1><p>Hold scanner steady</p>';
      App.renderQRCarousel(card, base64);
    }, 100);
  },

  buildChatView() {
    const tpl = document.getElementById('tpl-chat').content.cloneNode(true);
    App.container.appendChild(tpl);

    const diceBtn = document.getElementById('btn-dice'); const diceMenu = document.getElementById('dice-menu');
    diceBtn.onclick = (e) => { e.stopPropagation(); diceMenu.classList.toggle('active'); };
    document.addEventListener('click', (e) => { if(diceMenu && !diceMenu.contains(e.target) && e.target !== diceBtn) diceMenu.classList.remove('active'); });

    document.getElementById('btn-set-dir').onclick = async () => { diceMenu.classList.remove('active'); const ok = await FileSystem.requestDirectory(); if(ok) document.getElementById('btn-set-dir').style.color = '#10b981'; };
    document.getElementById('btn-screen-cast').onclick = () => { diceMenu.classList.remove('active'); connection.toggleScreenCasting(); };
    const btnFullscreen = document.getElementById('btn-fullscreen-cast');
    if (btnFullscreen) {
      btnFullscreen.onclick = () => {
        const cont = document.getElementById('media-container');
        if (!document.fullscreenElement) {
          if (cont.requestFullscreen) cont.requestFullscreen();
          else if (cont.webkitRequestFullscreen) cont.webkitRequestFullscreen();
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
      };
    }
    
    document.getElementById('btn-chat-settings').onclick = () => { 
      diceMenu.classList.remove('active'); 
      document.getElementById('settings-overlay').classList.remove('hidden'); 
      if(connection) {
         document.getElementById('setting-row-battery').style.display = 'flex';
         document.getElementById('battery-text').textContent = "Fetching...";
         connection.sendPayload(JSON.stringify({v: Protocol.VERSION, type: Protocol.TYPES.BATTERY_REQ}));
      }
    };

    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-file').onclick = () => { diceMenu.classList.remove('active'); fileInput.click(); };
    fileInput.onchange = (e) => {
      if(e.target.files.length && connection) {
        const batchId = 'b-' + Utils.generateId();
        App.activeBatches[batchId] = { count: e.target.files.length, current: 0, ui: null };
        if (e.target.files.length > 1) {
          const log = document.getElementById('chat-log');
          const wrap = Utils.createElement('div', '', 'msg-wrap self'); wrap.id = 'batch-' + batchId;
          wrap.innerHTML = `<div class="msg-bubble batch-folder"><div class="batch-header">📁 Sending ${e.target.files.length} Files <span>▼</span></div><div class="batch-list" id="blist-${batchId}"></div></div>`;
          wrap.querySelector('.batch-header').onclick = (ev) => ev.currentTarget.nextElementSibling.classList.toggle('open');
          log.appendChild(wrap); log.scrollTop = log.scrollHeight;
          App.activeBatches[batchId].ui = document.getElementById(`blist-${batchId}`);
        }
        connection.enqueueFiles(e.target.files, batchId); 
      }
      fileInput.value = ''; 
    };

    DrawController.init('chat-canvas', (cmdStr) => connection.sendPayload(cmdStr));
    const drawToolbar = document.getElementById('draw-toolbar');
    const drawCollapseBtn = document.getElementById('btn-draw-collapse');
    
    const toggleDraw = (mode) => {
      diceMenu.classList.remove('active');
      const btnCanvas = document.getElementById('btn-draw-canvas');
      const btnChat = document.getElementById('btn-draw-chat');
      
      if (DrawController.isActive && DrawController.currentMode === mode) {
        DrawController.toggle(false);
        drawToolbar.classList.add('hidden');
        drawToolbar.classList.remove('collapsed');
        btnCanvas.classList.remove('active-green'); btnChat.classList.remove('active-green');
      } else {
        DrawController.toggle(true, mode);
        drawToolbar.classList.remove('hidden');
        if(mode === 'canvas') { btnCanvas.classList.add('active-green'); btnChat.classList.remove('active-green'); }
        else { btnChat.classList.add('active-green'); btnCanvas.classList.remove('active-green'); }
      }
    };
    
    document.getElementById('btn-draw-canvas').onclick = () => toggleDraw('canvas');
    document.getElementById('btn-draw-chat').onclick = () => toggleDraw('chat');
    
    drawCollapseBtn.onclick = () => drawToolbar.classList.toggle('collapsed');
    
    document.getElementById('btn-draw-undo').onclick = () => DrawController.undo(true);
    document.getElementById('btn-draw-download').onclick = () => DrawController.download();
    document.getElementById('btn-draw-share').onclick = () => DrawController.share();
    document.getElementById('btn-draw-send').onclick = () => DrawController.sendAsMessage(false);
    document.getElementById('btn-draw-close').onclick = () => { DrawController.clear(true); };

    const log = document.getElementById('chat-log');
    const scrollDownBtn = document.getElementById('scroll-down-btn');
    const scrollBadge = document.getElementById('scroll-badge');
    
    log.addEventListener('scroll', () => {
      const maxScroll = log.scrollHeight - log.clientHeight;
      App.isScrolledUp = maxScroll - log.scrollTop > 50;
      if (!App.isScrolledUp) {
         App.unreadCount = 0;
         scrollBadge.classList.add('hidden');
         scrollDownBtn.classList.add('hidden');
      } else {
         scrollDownBtn.classList.remove('hidden');
      }
    });

    scrollDownBtn.onclick = () => {
      log.scrollTop = log.scrollHeight;
      App.unreadCount = 0;
      scrollBadge.classList.add('hidden');
    };

    const input = document.getElementById('chat-input'); let ghostTimeout;
    input.addEventListener('input', function() {
      this.style.height = '44px';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px'; 
      if (App.settings.ghostTyping && connection) {
        connection.sendPayload(Protocol.createGhostTyping(this.value, true));
        clearTimeout(ghostTimeout); ghostTimeout = setTimeout(() => connection.sendPayload(Protocol.createGhostTyping('', false)), 2000);
      }
    });
    
    document.getElementById('close-reply').onclick = () => {
      activeReplyMsg = null;
      document.getElementById('reply-preview').classList.add('hidden');
    };

    const sendBtn = document.getElementById('btn-send');
    const sendMsg = () => {
      const txt = input.value.trim(); if (!txt || !connection) return;
      const msg = Protocol.createChatMessage(txt, activeReplyMsg); connection.sendPayload(msg);
      if(App.settings.ghostTyping) connection.sendPayload(Protocol.createGhostTyping('', false));
      App.renderMessage(JSON.parse(msg), true); Synthesizer.playPop(); 
      input.value = ''; input.style.height = '44px';
      
      activeReplyMsg = null;
      document.getElementById('reply-preview').classList.add('hidden');
    };

    sendBtn.addEventListener('pointerdown', (e) => e.preventDefault()); 
    sendBtn.onclick = (e) => { e.preventDefault(); sendMsg(); };

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    input.onkeydown = (e) => { 
      if (e.key === 'Enter' && !e.shiftKey) { 
        if (isMobile) return; else { e.preventDefault(); sendMsg(); }
      } 
    };
    
    const ctxMenu = document.getElementById('context-menu');
    document.getElementById('ctx-copy').onclick = () => {
      if(ctxMenu.dataset.text) navigator.clipboard.writeText(ctxMenu.dataset.text);
      ctxMenu.classList.add('hidden');
    };
    document.getElementById('ctx-reply').onclick = () => {
      activeReplyMsg = { id: ctxMenu.dataset.id, text: ctxMenu.dataset.text };
      document.getElementById('reply-preview-text').textContent = activeReplyMsg.text;
      document.getElementById('reply-preview').classList.remove('hidden');
      ctxMenu.classList.add('hidden');
      input.focus();
    };
    
    App.receiptObserver = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting && ent.target.dataset.status === 'deliv') {
          ent.target.dataset.status = 'seen';
          if(connection) connection.sendPayload(Protocol.createReceipt(ent.target.id, 2));
        }
      });
    }, { root: document.getElementById('chat-log'), threshold: 0.5 });
  },

  onStateChange(status, msg) {
    if (status === 'CONNECTED') {
      Synthesizer.init(); App.renderState('CONNECTED', true); App.startHUD();
    } else if (status === 'ERR_PEER_DISCONNECTED' || status === 'CLOSED') {
      clearInterval(App.sessionTimer); clearInterval(App.metricsInterval);
      document.getElementById('metrics-hud').style.display = 'none';
      App.showAlert(msg, "Disconnected"); App.renderState('IDLE', true);
    }
  },

  startHUD() {
    document.getElementById('metrics-hud').style.display = 'block';
    App.sessionStartTime = Date.now();
    App.sessionTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - App.sessionStartTime) / 1000);
      document.getElementById('session-timer').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }, 1000);

    App.metricsInterval = setInterval(() => {
      if(!connection) return; const current = connection.getMetrics();
      const diffRx = current.rxBytes - App.lastMetrics.rxBytes; const diffTx = current.txBytes - App.lastMetrics.txBytes;
      document.getElementById('transfer-speed').textContent = `${((diffRx + diffTx) / (1024 * 1024)).toFixed(2)} MB/s`;
      App.lastMetrics = { ...current };
      let usage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
      usage.up += diffTx; usage.down += diffRx; localStorage.setItem('wchat_data', JSON.stringify(usage));
      document.getElementById('data-counter').textContent = `${(usage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(usage.down/(1024*1024)).toFixed(2)} MB ⬇`;
    }, 1000);
  },

  onMessageRouter(msg) {
    if (msg.type === Protocol.TYPES.CHAT) { App.renderMessage(msg, false); Synthesizer.playSwoosh(); }
    else if (msg.type === Protocol.TYPES.GHOST) {
      const cont = document.getElementById('ghost-typing-container'); const txt = document.getElementById('ghost-text-preview');
      if (msg.active && msg.text) { cont.classList.remove('hidden'); txt.textContent = msg.text; if(!App.isScrolledUp) document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight; } 
      else { cont.classList.add('hidden'); txt.textContent = ''; }
    }
    else if ([Protocol.TYPES.DRAW_START, Protocol.TYPES.DRAW_PT, Protocol.TYPES.DRAW_UNDO, Protocol.TYPES.DRAW_CLEAR].includes(msg.type)) DrawController.handleNetworkCommand(msg);
    else if (msg.type === Protocol.TYPES.DRAW_FINISH) DrawController.sendAsMessage(true);
    else if (msg.type === Protocol.TYPES.FILE_START) App.onIncomingFileStart(msg);
    else if (msg.type === Protocol.TYPES.FILE_END) App.onIncomingFileEnd(msg.id);
    else if (msg.type === Protocol.TYPES.FILE_CANCEL) App.onIncomingFileEnd(msg.id, true);
    else if (msg.type === Protocol.TYPES.FILE_ACK) { if(connection) connection.onFileAck(msg.id); }
    else if (msg.type === Protocol.TYPES.RECEIPT) App.updateReceipt(msg.id, msg.status);
    else if (msg.type.startsWith('screen_')) connection.handleScreenSignal(msg);
    else if (msg.type === Protocol.TYPES.BATTERY_REQ) {
      if (navigator.getBattery) {
        navigator.getBattery().then(b => {
          connection.sendPayload(JSON.stringify({v: Protocol.VERSION, type: Protocol.TYPES.BATTERY_RES, level: Math.round(b.level * 100)}));
        }).catch(() => {
          connection.sendPayload(JSON.stringify({v: Protocol.VERSION, type: Protocol.TYPES.BATTERY_RES, level: 'ERR'}));
        });
      } else {
        connection.sendPayload(JSON.stringify({v: Protocol.VERSION, type: Protocol.TYPES.BATTERY_RES, level: 'UNSUPPORTED'}));
      }
    }
    else if (msg.type === Protocol.TYPES.BATTERY_RES) {
       if (msg.level === 'UNSUPPORTED' || msg.level === 'ERR') {
           document.getElementById('battery-text').textContent = "Not supported by device";
       } else {
           document.getElementById('battery-text').textContent = `${msg.level}% (Fetched at ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})`;
       }
    }
    else if (msg.type === Protocol.TYPES.WARN_DISCONNECT) {
       document.getElementById('peer-warn-banner').classList.remove('hidden');
    }
    else if (msg.type === Protocol.TYPES.CANCEL_DISCONNECT) {
       document.getElementById('peer-warn-banner').classList.add('hidden');
    }
  },

  renderMessage(msg, isSelf) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', `msg-wrap ${isSelf ? 'self' : 'peer'}`);
    wrap.id = msg.id;
    
    const txtTrimmed = msg.text.trim();
    const isSingleEmoji = Array.from(txtTrimmed).length === 1 && /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u.test(txtTrimmed);
    
    let html = `<div class="msg-bubble ${isSingleEmoji ? 'single-emoji' : ''}">`;
    if (msg.reply && !isSingleEmoji) {
      html += `<div class="msg-quote">${msg.reply.text}</div>`;
    }
    html += `${msg.text}</div><div class="msg-meta">${new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${isSelf ? `<span class="msg-ticks" id="tick-${msg.id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}</div>`;
    
    wrap.innerHTML = html;
    
    const bubble = wrap.querySelector('.msg-bubble');
    if(!isSingleEmoji) {
       
       let startX = 0, currentX = 0, isSwiping = false;
       bubble.addEventListener('touchstart', e => { 
           startX = e.touches[0].clientX; currentX = startX; isSwiping = true;
           bubble.classList.add('swiping'); 
       }, {passive: true});
       
       bubble.addEventListener('touchmove', e => {
           if(!isSwiping) return;
           currentX = e.touches[0].clientX;
           let diff = currentX - startX;
           if (diff > 0 && diff < 80) bubble.style.transform = `translateX(${diff}px)`;
       }, {passive: true});
       
       bubble.addEventListener('touchend', e => {
           if(!isSwiping) return;
           isSwiping = false;
           let diff = currentX - startX;
           bubble.classList.remove('swiping');
           bubble.style.transform = ''; 
           if (diff > 50) {
              activeReplyMsg = { id: msg.id, text: msg.text };
              document.getElementById('reply-preview-text').textContent = activeReplyMsg.text;
              document.getElementById('reply-preview').classList.remove('hidden');
              document.getElementById('chat-input').focus();
           }
       });

       bubble.addEventListener('click', (e) => {
         e.stopPropagation();
         const ctxMenu = document.getElementById('context-menu');
         ctxMenu.dataset.id = msg.id; ctxMenu.dataset.text = msg.text;
         
         const rect = bubble.getBoundingClientRect();
         let y = rect.bottom + 5;
         let x = rect.left;
         if (isSelf) x = rect.right - 120; 
         
         ctxMenu.style.top = `${Math.min(y, window.innerHeight - 80)}px`;
         ctxMenu.style.left = `${Math.max(10, Math.min(x, window.innerWidth - 130))}px`;
         ctxMenu.classList.remove('hidden');
       });
    }

    log.appendChild(wrap);
    
    if (App.isScrolledUp && !isSelf) {
      App.unreadCount++;
      const scrollBadge = document.getElementById('scroll-badge');
      scrollBadge.textContent = App.unreadCount;
      scrollBadge.classList.remove('hidden');
    } else {
      log.scrollTop = log.scrollHeight;
    }

    if (!isSelf) { wrap.dataset.status = 'deliv'; App.receiptObserver.observe(wrap); }
  },

  renderDrawingMessage(dataUrl, isSelf) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', `msg-wrap ${isSelf ? 'self' : 'peer'}`);
    wrap.innerHTML = `<div class="msg-bubble" style="padding: 4px; overflow: hidden; background: transparent; border: none; box-shadow: none;">
                        <img src="${dataUrl}" class="media-preview canvas-snapshot">
                      </div><div class="msg-meta" style="justify-content:${isSelf ? 'flex-end' : 'flex-start'};">Drawing</div>`;
    log.appendChild(wrap); 
    if(!App.isScrolledUp || isSelf) log.scrollTop = log.scrollHeight;
  },

  updateReceipt(id, status) {
    const tick = document.getElementById(`tick-${id}`); if(!tick) return;
    if(status === 1) tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M18 6l-9 11-4-5"/><path d="M22 6l-9 11"/></svg>';
    if(status === 2) tick.classList.add('seen');
  },

  async onIncomingFileStart(msg) {
    let stream = null; let fileHandle = null;
    if (FileSystem.sessionFolder) {
      const res = await FileSystem.createWritable(msg.name);
      if (res) { stream = res.stream || res; fileHandle = res.fileHandle || null; }
    }
    
    if(msg.bId && msg.bTot > 1 && !App.activeBatches[msg.bId]) {
      App.activeBatches[msg.bId] = { count: msg.bTot, current: 0, ui: null };
      const log = document.getElementById('chat-log');
      const wrap = Utils.createElement('div', '', 'msg-wrap peer'); wrap.id = 'batch-' + msg.bId;
      wrap.innerHTML = `<div class="msg-bubble batch-folder"><div class="batch-header">📁 Receiving ${msg.bTot} Files <span>▼</span></div><div class="batch-list" id="blist-${msg.bId}"></div></div>`;
      wrap.querySelector('.batch-header').onclick = (ev) => ev.currentTarget.nextElementSibling.classList.toggle('open');
      log.appendChild(wrap); if(!App.isScrolledUp) log.scrollTop = log.scrollHeight;
      App.activeBatches[msg.bId].ui = document.getElementById(`blist-${msg.bId}`);
    }

    App.activeIncomingFile = { id: msg.id, name: msg.name, size: msg.size, mime: msg.mime, chunks: [], stream: stream, fileHandle: fileHandle, received: 0, bId: msg.bId, writeQueue: Promise.resolve() };
    App.onFileTransferStart(msg.id, msg.name, msg.size, false, msg.bId);
  },

  async onBinaryChunkReceived(buffer) {
    const f = App.activeIncomingFile; if(!f) return;
    
    const safeBuffer = buffer.slice(0); 
    f.received += safeBuffer.byteLength;
    
    if (f.stream) {
        f.writeQueue = f.writeQueue
            .then(() => f.stream.write(safeBuffer))
            .catch(err => {
                console.warn("Disk write failed, reverting to RAM chunking:", err);
                f.stream = null;
                f.chunks.push(safeBuffer); 
            });
    } else {
        f.chunks.push(safeBuffer); 
    }
    
    App.onFileTransferProgress(f.id, (f.received / f.size) * 100);
  },

  async onIncomingFileEnd(id, aborted = false) {
    const f = App.activeIncomingFile; 
    
    if(!f || f.id !== id) {
       if(connection) connection.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.FILE_ACK, id: id }));
       return; 
    }
    
    App.activeIncomingFile = null;
    let url = null;
    
    try {
      if (f.stream) {
        await f.writeQueue.catch(e => console.warn(e));
        try { await f.stream.close(); } catch(e){}
        if (f.fileHandle && (f.mime.startsWith('image/') || f.mime.startsWith('video/') || f.mime.startsWith('audio/'))) {
           try { const file = await f.fileHandle.getFile(); url = URL.createObjectURL(file); } catch(e){}
        }
      }
      else if (!aborted) {
        const blob = new Blob(f.chunks, {type: f.mime || 'application/octet-stream'}); 
        url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 100);
      }
    } catch (err) {
      console.error("Error finalizing file:", err);
    } finally {
      App.onFileTransferComplete(id, url, !aborted, f.mime);
      if(connection) {
         connection.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.FILE_ACK, id: id }));
      }
    }
  },

  _insertMediaPreview(box, url, mimeType) {
    if (mimeType.startsWith('image/')) { 
      const img = document.createElement('img'); img.src = url; img.className = 'media-preview'; img.onclick = () => window.open(url); box.insertBefore(img, box.firstChild); 
    } 
    else if (mimeType.startsWith('video/')) { 
      const vid = document.createElement('video'); vid.src = url; vid.className = 'media-preview'; vid.controls = true; vid.muted = true; box.insertBefore(vid, box.firstChild); 
    }
    else if (mimeType.startsWith('audio/')) { 
      const aud = document.createElement('audio'); aud.src = url; aud.className = 'media-preview-audio'; aud.controls = true; box.insertBefore(aud, box.firstChild); 
    }
  },

  onFileTransferStart(id, name, size, isUpload, batchId = null, fileObj = null) {
    const log = document.getElementById('chat-log');
    const boxHTML = `<div class="file-row"><strong class="file-name" title="${name}">${name}</strong>${isUpload ? `<button class="btn-cancel" onclick="connection.cancelActiveTransfer()" title="Cancel">✕</button>` : ''}</div><div class="file-row" style="color:var(--text-sub);"><small>${(size/(1024*1024)).toFixed(2)} MB</small><small id="text-${id}">${isUpload ? 'Sending' : 'Receiving'}...</small></div><div class="file-progress-bg"><div id="prog-${id}" class="file-progress-fill"></div></div>`;
    const el = Utils.createElement('div', '', 'msg-bubble file-bubble'); el.id = 'ui-f-' + id; el.innerHTML = boxHTML;
    
    if (isUpload && fileObj) {
      const url = URL.createObjectURL(fileObj);
      App._insertMediaPreview(el, url, fileObj.type);
    }

    const target = (batchId && App.activeBatches[batchId]?.ui) ? App.activeBatches[batchId].ui : log;
    if (target === log) { 
       const wrap = Utils.createElement('div', '', `msg-wrap ${isUpload ? 'self' : 'peer'}`); wrap.appendChild(el); target.appendChild(wrap); 
    } else { 
       el.style.width = '100%'; el.style.border = '1px solid var(--border)'; target.appendChild(el); 
    }
    if(!App.isScrolledUp) log.scrollTop = log.scrollHeight;
  },

  onFileTransferProgress(id, percent) {
    const bar = document.getElementById(`prog-${id}`); const txt = document.getElementById(`text-${id}`);
    if(bar) bar.style.width = `${percent}%`; if(txt) txt.textContent = `${Math.floor(percent)}%`;
  },

  onFileTransferComplete(id, url, success, mimeType = '') {
    const box = document.getElementById(`ui-f-${id}`); if(!box) return;
    const txt = document.getElementById(`text-${id}`); const bar = document.getElementById(`prog-${id}`);
    if(success && bar) bar.style.width = '100%';
    if(!success) { if(txt) txt.textContent = '❌ Cancelled'; return; }
    
    txt.innerHTML = (FileSystem.sessionFolder ? 'Saved' : 'Complete') + ' <span style="color:#10b981;">✔</span>';
    const cancelBtn = box.querySelector('.btn-cancel'); if(cancelBtn) cancelBtn.remove();
    
    if (url && !box.querySelector('.media-preview') && !box.querySelector('.media-preview-audio')) { 
      App._insertMediaPreview(box, url, mimeType); 
    }

    if (url && !FileSystem.sessionFolder) {
        const topRow = box.querySelector('.file-row');
        if (topRow && !topRow.querySelector('.btn-manual-save')) {
            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn-manual-save';
            saveBtn.style.cssText = 'background: transparent; color: var(--primary); border: 1px solid var(--primary); padding: 2px 8px; font-size: 0.75rem; border-radius: 6px; margin: 0 0 0 8px; cursor: pointer; height: auto; width: auto; font-weight: bold; flex-shrink: 0;';
            saveBtn.innerText = '⬇ Save';
            saveBtn.onclick = (e) => {
                e.stopPropagation();
                const a = document.createElement('a'); 
                a.href = url; 
                a.download = box.querySelector('.file-name').title || 'download';
                document.body.appendChild(a); 
                a.click(); 
                document.body.removeChild(a);
            };
            topRow.appendChild(saveBtn);
        }
    }
  },

  onScreenCastReceived(stream) {
    let cont = document.getElementById('media-container'); cont.classList.remove('hidden');
    let video = document.getElementById('remote-screen');
    if (!video) {
      video = document.createElement('video'); video.id = 'remote-screen'; video.autoplay = true; video.playsInline = true; video.muted = true; cont.appendChild(video);
    }
    video.srcObject = stream;
  }
};

window.onload = () => App.init();
