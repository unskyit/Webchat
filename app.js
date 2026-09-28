// app.js - Controller, Event Routing & UI Lifecycle

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 
let connection = null;
let html5QrCode = null;
let deferredPrompt = null;

const animHTML = `
  <div class="link-animation">
    <div class="orb"></div>
    <div class="beam-container"><div class="beam"></div></div>
    <div class="orb"></div>
  </div>
`;

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
  
  // Sent Sound: A quick, crisp, subtle 'tick'
  playPop() {
    if(!this.ctx || !App.settings.sound) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); 
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    
    osc.type = 'sine'; 
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.07);
    
    gain.gain.setValueAtTime(0, t); 
    gain.gain.linearRampToValueAtTime(0.15, t + 0.01); 
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
    
    osc.start(t); osc.stop(t + 0.1);
  },

  // Received Sound: A soft, clean two-tone 'da-ding' chime
  playSwoosh() {
    if(!this.ctx || !App.settings.sound) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); 
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    
    osc.type = 'sine'; 
    // First note (lower)
    osc.frequency.setValueAtTime(650, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.linearRampToValueAtTime(0, t + 0.08);
    
    // Second note (higher)
    osc.frequency.setValueAtTime(850, t + 0.09);
    gain.gain.setValueAtTime(0, t + 0.09);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.11);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    
    osc.start(t); osc.stop(t + 0.35);
  }
};

const App = {
  container: document.getElementById('app-container'),
  settings: { darkMode: false, useCloud: true, qrChunks: 3, ghostTyping: false, sound: true },
  sessionTimer: null, sessionStartTime: 0,
  metricsInterval: null, lastMetrics: { rxBytes: 0, txBytes: 0 },
  activeIncomingFile: null, activeBatches: {},

  init() {
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.view) App.renderState(e.state.view, false);
      else App.renderState('IDLE', false);
    });

    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-overlay').classList.add('hidden');
    document.getElementById('toggle-theme').onchange = (e) => { App.settings.darkMode = e.target.checked; document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode'; };
    document.getElementById('toggle-sound').onchange = (e) => App.settings.sound = e.target.checked;
    document.getElementById('toggle-ghost').onchange = (e) => App.settings.ghostTyping = e.target.checked;
    document.getElementById('toggle-mode').onchange = (e) => {
      App.settings.useCloud = e.target.checked;
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

    App.renderState('IDLE', true);
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
    
    const headerActions = document.getElementById('header-actions');
    if (state === 'IDLE') {
      if(window.DrawController) DrawController.clear(false); 
      headerActions.innerHTML = `<button id="btn-settings-head" class="icon-btn" title="Settings"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>`;
      document.getElementById('btn-settings-head').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
      App.buildIdleView();
    }
    else if (state === 'CONNECTED') {
      headerActions.innerHTML = `<button id="btn-end-head" class="btn-danger">End Chat</button>`;
      document.getElementById('btn-end-head').onclick = () => { if(connection) connection.destroy(); App.renderState('IDLE'); };
      App.buildChatView();
    }
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
        if (sig) App.handleManualJoin(sig); else { alert("Invalid Offer Code."); App.renderState('IDLE'); }
      });
      card.appendChild(btnHost); card.appendChild(btnJoin);
    }
    view.appendChild(card); App.container.appendChild(view);
  },

  renderScannerUI(expectedType, onSuccess) {
    const view = Utils.createElement('div', '', 'view idle-view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">Scan QR</h1><p>Point camera at the QR code(s).</p>`;
    
    const instruction = Utils.createElement('div', 'Scan QR Code 1', 'scan-instruction');
    const readerWrapper = Utils.createElement('div'); readerWrapper.id = 'reader-container'; readerWrapper.style.display = 'none';
    card.appendChild(instruction); card.appendChild(readerWrapper);

    let scannedParts = []; let expectedParts = 0;
    const handleScan = async (text) => {
       if (text.startsWith('WCT:')) {
          const parts = text.split(':');
          if (parts.length >= 3) {
             const info = parts[1].split('/');
             const index = parseInt(info[0]) - 1; expectedParts = parseInt(info[1]);
             if (!scannedParts[index]) scannedParts[index] = parts.slice(2).join(':'); 
             const scannedCount = scannedParts.filter(Boolean).length;
             if (scannedCount === expectedParts) { await App.stopScannerSafely(); instruction.textContent = "Connecting..."; onSuccess(scannedParts.join('')); } 
             else { instruction.textContent = `Scanned ${scannedCount} of ${expectedParts}. Scan next!`; }
          }
       } else { await App.stopScannerSafely(); onSuccess(extractCode(text)); }
    };

    const startCam = async () => {
       await App.stopScannerSafely(); readerWrapper.style.display = 'block';
       html5QrCode = new Html5Qrcode("reader-container");
       try { await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.8, height: Math.min(vw, vh) * 0.8 }) }, handleScan); } 
       catch(e) { alert("Camera failed."); }
    };

    const btnCam = Utils.createElement('button', '📸 Open Camera', 'secondary'); btnCam.onclick = () => startCam();
    const btnBack = Utils.createElement('button', 'Cancel', 'secondary'); btnBack.onclick = () => App.renderState('IDLE');
    
    card.appendChild(btnCam); card.appendChild(btnBack);
    view.appendChild(card); App.container.innerHTML = ''; App.container.appendChild(view);
  },

  renderQRCarousel(container, base64Payload) {
    const chunks = createQRChunks(base64Payload); let currentIndex = 0;
    const qrWrap = Utils.createElement('div'); const qrDiv = Utils.createElement('div'); qrDiv.id = 'qrcode'; qrWrap.appendChild(qrDiv);

    if(chunks.length > 1) {
      const navWrap = Utils.createElement('div', '', 'qr-carousel');
      const btnPrev = Utils.createElement('button', '❮', 'secondary qr-nav-btn'); const btnNext = Utils.createElement('button', '❯', 'secondary qr-nav-btn');
      const lblStatus = Utils.createElement('span', `QR 1 of ${chunks.length}`, 'qr-status');
      navWrap.appendChild(btnPrev); navWrap.appendChild(lblStatus); navWrap.appendChild(btnNext); qrWrap.appendChild(navWrap);

      const updateQR = () => {
        qrDiv.innerHTML = '';
        new QRCode(qrDiv, { text: chunks[currentIndex], width: 250, height: 250, colorDark : "#000000", colorLight : "#ffffff", correctLevel: QRCode.CorrectLevel.L });
        lblStatus.textContent = `QR ${currentIndex + 1} of ${chunks.length}`;
        btnPrev.disabled = currentIndex === 0; btnNext.disabled = currentIndex === chunks.length - 1;
      };
      btnPrev.onclick = () => { if(currentIndex > 0) { currentIndex--; updateQR(); }};
      btnNext.onclick = () => { if(currentIndex < chunks.length - 1) { currentIndex++; updateQR(); }};
      setTimeout(updateQR, 100);
    } else { setTimeout(() => new QRCode(qrDiv, { text: chunks[0], width: 250, height: 250, colorDark : "#000000", colorLight : "#ffffff", correctLevel: QRCode.CorrectLevel.L }), 100); }
    container.appendChild(qrWrap);
  },

  async hostCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Room Created</h1><h2 class="otp-input">${pin}</h2>${animHTML}<p>Waiting for friend...</p>`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const offerStr = await connection.generateOffer();
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'offer', payload: offerStr }) });
      const poll = setInterval(async () => {
        const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_answer`);
        const data = await res.json();
        if (data.payload) { clearInterval(poll); const answerSignal = Protocol.validateSignal(data.payload, 'answer'); if (answerSignal) connection.acceptAnswer(answerSignal); }
      }, 3000);
    } catch(e) { alert("Network failed."); App.renderState('IDLE'); }
  },

  async joinCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Connecting...</h1><p>PIN: ${pin}</p>${animHTML}`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_offer`);
      const data = await res.json();
      if (!data.payload) throw new Error("Room not found.");
      const answerStr = await connection.acceptOfferAndGenerateAnswer(Protocol.validateSignal(data.payload, 'offer'));
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'answer', payload: answerStr }) });
    } catch(e) { alert(e.message); App.renderState('IDLE'); }
  },

  async hostManualRoom() {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Generating Keys...</h1>${animHTML}`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);

    setTimeout(async () => {
      connection = new P2PConnection(App);
      const offerStr = await connection.generateOffer();
      const base64 = Utils.encodeBase64Url(offerStr);
      card.innerHTML = '<h1 class="brand">Offline Room</h1><p>Share this QR to connect</p>';
      App.renderQRCarousel(card, base64);
      setTimeout(() => {
        const btnScan = Utils.createElement('button', 'Provide Answer Code');
        btnScan.onclick = () => App.renderScannerUI('answer', (decoded) => {
           const ans = Protocol.validateSignal(Utils.decodeBase64Url(decoded), 'answer');
           if(ans) connection.acceptAnswer(ans); else { alert("Invalid."); App.renderState('IDLE'); } 
        });
        card.appendChild(btnScan);
      }, 200);
    }, 100);
  },

  async handleManualJoin(offerSignal) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Securing...</h1>${animHTML}`;
    App.container.innerHTML = '<div class="view idle-view"></div>'; App.container.firstChild.appendChild(card);

    setTimeout(async () => {
      connection = new P2PConnection(App);
      const ansStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      const base64 = Utils.encodeBase64Url(ansStr);
      card.innerHTML = '<h1 class="brand">Send Answer</h1><p>Scan this back to the Host</p>';
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
    document.getElementById('btn-chat-settings').onclick = () => { diceMenu.classList.remove('active'); document.getElementById('settings-overlay').classList.remove('hidden'); };

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
    document.getElementById('btn-draw-toggle').onclick = () => { diceMenu.classList.remove('active'); DrawController.toggle(!DrawController.isActive); drawToolbar.classList.toggle('hidden', !DrawController.isActive); };
    document.querySelectorAll('.color-swatch').forEach(el => { el.onclick = () => { document.querySelector('.color-swatch.active').classList.remove('active'); el.classList.add('active'); DrawController.setColor(el.dataset.color); }; });
    document.getElementById('btn-draw-undo').onclick = () => DrawController.undo(true);
    document.getElementById('btn-draw-clear').onclick = () => DrawController.clear(true);
    document.getElementById('btn-draw-close').onclick = () => { DrawController.toggle(false); drawToolbar.classList.add('hidden'); };

    const input = document.getElementById('chat-input'); let ghostTimeout;
    input.addEventListener('input', function() {
      this.style.height = '44px';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px'; 
      if (App.settings.ghostTyping && connection) {
        connection.sendPayload(Protocol.createGhostTyping(this.value, true));
        clearTimeout(ghostTimeout); ghostTimeout = setTimeout(() => connection.sendPayload(Protocol.createGhostTyping('', false)), 2000);
      }
    });
    
    const sendBtn = document.getElementById('btn-send');
    const sendMsg = () => {
      const txt = input.value.trim(); if (!txt || !connection) return;
      const msg = Protocol.createChatMessage(txt); connection.sendPayload(msg);
      if(App.settings.ghostTyping) connection.sendPayload(Protocol.createGhostTyping('', false));
      App.renderMessage(JSON.parse(msg), true); Synthesizer.playPop(); 
      input.value = ''; input.style.height = '44px';
    };

    // Keep mobile keyboard open when sending
    sendBtn.addEventListener('pointerdown', (e) => e.preventDefault()); 
    sendBtn.onclick = (e) => { e.preventDefault(); sendMsg(); };
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };
    
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
      alert(msg); App.renderState('IDLE', true);
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
      if (msg.active && msg.text) { cont.classList.remove('hidden'); txt.textContent = msg.text; document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight; } 
      else { cont.classList.add('hidden'); txt.textContent = ''; }
    }
    else if ([Protocol.TYPES.DRAW, Protocol.TYPES.DRAW_UNDO, Protocol.TYPES.DRAW_CLEAR].includes(msg.type)) DrawController.handleNetworkCommand(msg);
    else if (msg.type === Protocol.TYPES.FILE_START) App.onIncomingFileStart(msg);
    else if (msg.type === Protocol.TYPES.FILE_END) App.onIncomingFileEnd(msg.id);
    else if (msg.type === Protocol.TYPES.FILE_CANCEL) App.onIncomingFileEnd(msg.id, true);
    else if (msg.type === Protocol.TYPES.RECEIPT) App.updateReceipt(msg.id, msg.status);
    else if (msg.type.startsWith('screen_')) connection.handleScreenSignal(msg);
  },

  renderMessage(msg, isSelf) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', `msg-wrap ${isSelf ? 'self' : 'peer'}`);
    wrap.id = msg.id;
    wrap.innerHTML = `<div class="msg-bubble">${msg.text}</div><div class="msg-meta">${new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${isSelf ? `<span class="msg-ticks" id="tick-${msg.id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}</div>`;
    log.appendChild(wrap); log.scrollTop = log.scrollHeight;
    if (!isSelf) { wrap.dataset.status = 'deliv'; App.receiptObserver.observe(wrap); }
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
      if (res) { stream = res.stream; fileHandle = res.fileHandle; }
    }
    
    if(msg.bId && msg.bTot > 1 && !App.activeBatches[msg.bId]) {
      App.activeBatches[msg.bId] = { count: msg.bTot, current: 0, ui: null };
      const log = document.getElementById('chat-log');
      const wrap = Utils.createElement('div', '', 'msg-wrap peer'); wrap.id = 'batch-' + msg.bId;
      wrap.innerHTML = `<div class="msg-bubble batch-folder"><div class="batch-header">📁 Receiving ${msg.bTot} Files <span>▼</span></div><div class="batch-list" id="blist-${msg.bId}"></div></div>`;
      wrap.querySelector('.batch-header').onclick = (ev) => ev.currentTarget.nextElementSibling.classList.toggle('open');
      log.appendChild(wrap); log.scrollTop = log.scrollHeight;
      App.activeBatches[msg.bId].ui = document.getElementById(`blist-${msg.bId}`);
    }

    // FIX: Added 'writeQueue' to prevent disk-write race conditions causing the 0% bug
    App.activeIncomingFile = { id: msg.id, name: msg.name, size: msg.size, mime: msg.mime, chunks: [], stream: stream, fileHandle: fileHandle, received: 0, bId: msg.bId, writeQueue: Promise.resolve() };
    App.onFileTransferStart(msg.id, msg.name, msg.size, false, msg.bId);
  },

  async onBinaryChunkReceived(buffer) {
    const f = App.activeIncomingFile; if(!f) return;
    f.received += buffer.byteLength;
    if (f.stream) {
       // FIX: Queue stream writes sequentially to prevent concurrent write crashes
       f.writeQueue = f.writeQueue.then(() => f.stream.write(buffer));
    } else { 
       f.chunks.push(buffer); 
    }
    App.onFileTransferProgress(f.id, (f.received / f.size) * 100);
  },

  async onIncomingFileEnd(id, aborted = false) {
    const f = App.activeIncomingFile; if(!f || f.id !== id) return;
    let url = null;
    
    if (f.stream) {
      await f.writeQueue; // Wait for all queued disk writes to finish
      await f.stream.close();
      
      // Generate preview for media even if it was saved directly to disk
      if (f.fileHandle && (f.mime.startsWith('image/') || f.mime.startsWith('video/') || f.mime.startsWith('audio/'))) {
         const file = await f.fileHandle.getFile();
         url = URL.createObjectURL(file);
      }
    }
    else if (!aborted) {
      const blob = new Blob(f.chunks, {type: f.mime}); url = URL.createObjectURL(blob);
      if(!f.mime.startsWith('image/') && !f.mime.startsWith('video/') && !f.mime.startsWith('audio/')) { 
         const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); 
      }
    }
    
    App.onFileTransferComplete(id, url, !aborted, f.mime);
    App.activeIncomingFile = null;
  },

  // Helper method to insert media previews safely
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
    
    // FIX: Using class "file-name" to enforce ellipsis truncation
    const boxHTML = `<div class="file-row"><strong class="file-name" title="${name}">${name}</strong>${isUpload ? `<button class="btn-cancel" onclick="connection.cancelActiveTransfer()" title="Cancel">✕</button>` : ''}</div><div class="file-row" style="color:var(--text-sub);"><small>${(size/(1024*1024)).toFixed(2)} MB</small><small id="text-${id}">${isUpload ? 'Sending' : 'Receiving'}...</small></div><div class="file-progress-bg"><div id="prog-${id}" class="file-progress-fill"></div></div>`;
    const el = Utils.createElement('div', '', 'msg-bubble file-bubble'); el.id = 'ui-f-' + id; el.innerHTML = boxHTML;
    
    // Generate immediate media preview for the sender
    if (isUpload && fileObj) {
      const url = URL.createObjectURL(fileObj);
      App._insertMediaPreview(el, url, fileObj.type);
    }

    const target = (batchId && App.activeBatches[batchId]?.ui) ? App.activeBatches[batchId].ui : log;
    if (target === log) { 
       const wrap = Utils.createElement('div', '', `msg-wrap ${isUpload ? 'self' : 'peer'}`); wrap.appendChild(el); target.appendChild(wrap); 
    } 
    else { 
       el.style.width = '100%'; el.style.border = '1px solid var(--border)'; target.appendChild(el); 
       // FIX: Removed target.classList.add('open') so batch lists stay collapsed by default
    }
    log.scrollTop = log.scrollHeight;
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
    
    // FIX: Replaced emoji with a styled green tickmark
    if(txt) txt.innerHTML = (FileSystem.sessionFolder ? 'Saved' : 'Complete') + ' <span style="color:#10b981;">✔</span>';

    const cancelBtn = box.querySelector('.btn-cancel'); if(cancelBtn) cancelBtn.remove();
    
    // Generate preview for receiver if it wasn't already generated on the sender side
    if (url && !box.querySelector('.media-preview') && !box.querySelector('.media-preview-audio')) {
       App._insertMediaPreview(box, url, mimeType);
    }
  },

  onScreenCastReceived(stream) {
    let cont = document.getElementById('media-container');
    cont.classList.remove('hidden');
    let video = document.getElementById('remote-screen');
    if (!video) {
      video = document.createElement('video'); video.id = 'remote-screen';
      video.autoplay = true; video.playsInline = true; video.muted = true;
      cont.appendChild(video);
    }
    video.srcObject = stream;
  }
};

window.onload = () => App.init();
