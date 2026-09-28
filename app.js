// app.js - Full UI Architecture, Connection Engine, Ghost Typing & App State

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

// Zero Dependency Audio Synthesizer
const Synthesizer = {
  ctx: null,
  init() { if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
  playPop() {
    if(!this.ctx) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.1);
  },
  playSwoosh() {
    if(!this.ctx) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'triangle'; osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.2);
  }
};

const App = {
  container: document.getElementById('app-container'),
  settings: { darkMode: false, useCloud: true, qrChunks: 3, ghostTyping: false },
  sessionTimer: null, sessionStartTime: 0,
  metricsInterval: null, lastMetrics: { rxBytes: 0, txBytes: 0 },
  activeIncomingFile: null,

  init() {
    // Physical Back Button Support via History API
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.view) App.renderState(e.state.view, false);
      else App.renderState('IDLE', false);
    });

    // Modals & Settings Links
    document.getElementById('btn-settings').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-overlay').classList.add('hidden');
    
    document.getElementById('toggle-theme').onchange = (e) => {
      App.settings.darkMode = e.target.checked;
      document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode';
    };
    
    document.getElementById('toggle-mode').onchange = (e) => {
      App.settings.useCloud = e.target.checked;
      document.getElementById('mode-desc').textContent = App.settings.useCloud ? "Cloud OTP (Requires Internet)" : "Manual/QR (Works Offline)";
      App.renderState('IDLE', true);
    };

    document.getElementById('toggle-ghost').onchange = (e) => App.settings.ghostTyping = e.target.checked;

    const qrSlider = document.getElementById('qr-slider');
    if (qrSlider) {
      qrSlider.oninput = (e) => {
        App.settings.qrChunks = parseInt(e.target.value);
        document.getElementById('qr-slider-val').textContent = App.settings.qrChunks;
      };
    }

    // PWA Install Logic
    const btnInstall = document.getElementById('btn-install-pwa');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e; btnInstall.classList.remove('hidden');
    });
    btnInstall.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null; btnInstall.classList.add('hidden');
      }
    });

    // Total Data Persistence UI
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
    
    if (state === 'IDLE') App.buildIdleView();
    else if (state === 'CONNECTED') App.buildChatView();
  },

  // -------------------------
  // 1. CONNECTION UI LOGIC
  // -------------------------
  buildIdleView() {
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
        else { alert("Invalid Offer Code."); App.renderState('IDLE'); }
      });
      card.appendChild(btnHost); card.appendChild(btnJoin);
    }
    view.appendChild(card); App.container.appendChild(view);
  },

  renderScannerUI(expectedType, onSuccess) {
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">Scan QR</h1><p>Point camera at the QR code(s).</p>`;
    
    const instruction = Utils.createElement('div', 'Scan QR Code 1', 'scan-instruction');
    const readerWrapper = Utils.createElement('div'); readerWrapper.id = 'reader-container'; readerWrapper.style.display = 'none';
    const btnGroup = Utils.createElement('div', '', 'scan-btn-group');
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
             if (scannedCount === expectedParts) {
                await App.stopScannerSafely(); instruction.textContent = "Connecting..."; onSuccess(scannedParts.join(''));
             } else { instruction.textContent = `Scanned ${scannedCount} of ${expectedParts}. Scan next!`; }
          }
       } else {
          await App.stopScannerSafely(); onSuccess(extractCode(text));
       }
    };

    const startCam = async () => {
       await App.stopScannerSafely(); readerWrapper.style.display = 'block';
       html5QrCode = new Html5Qrcode("reader-container");
       try { await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.8, height: Math.min(vw, vh) * 0.8 }) }, handleScan); } 
       catch(e) { alert("Camera failed."); }
    };

    const btnCam = Utils.createElement('button', '📸 Open Camera', 'secondary');
    btnCam.onclick = () => startCam();
    const btnBack = Utils.createElement('button', 'Cancel', 'secondary');
    btnBack.onclick = () => App.renderState('IDLE');
    
    btnGroup.appendChild(btnCam); card.appendChild(btnGroup); card.appendChild(btnBack);
    view.appendChild(card); App.container.innerHTML = ''; App.container.appendChild(view);
  },

  renderQRCarousel(container, base64Payload) {
    const chunks = createQRChunks(base64Payload); let currentIndex = 0;
    const qrWrap = Utils.createElement('div'); const qrDiv = Utils.createElement('div'); qrDiv.id = 'qrcode'; qrWrap.appendChild(qrDiv);

    if(chunks.length > 1) {
      const navWrap = Utils.createElement('div', '', 'qr-carousel');
      const btnPrev = Utils.createElement('button', '❮', 'secondary qr-nav-btn');
      const btnNext = Utils.createElement('button', '❯', 'secondary qr-nav-btn');
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
    card.innerHTML = `<h1 class="brand">Room Created</h1><p>Tell friend to enter PIN:</p><h2 class="otp-input">${pin}</h2>${animHTML}<p style="margin-top:10px; font-size:0.85rem;">Waiting for them...</p>`;
    App.container.innerHTML = '<div class="view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const offerStr = await connection.generateOffer();
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'offer', payload: offerStr }) });
      const poll = setInterval(async () => {
        const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_answer`);
        const data = await res.json();
        if (data.payload) {
          clearInterval(poll);
          const answerSignal = Protocol.validateSignal(data.payload, 'answer');
          if (answerSignal) connection.acceptAnswer(answerSignal);
        }
      }, 3000);
    } catch(e) { alert("Cloud failed."); App.renderState('IDLE'); }
  },

  async joinCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Connecting...</h1><p>Looking for PIN: ${pin}</p>${animHTML}`;
    App.container.innerHTML = '<div class="view"></div>'; App.container.firstChild.appendChild(card);
    
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
    App.container.innerHTML = '<div class="view"></div>'; App.container.firstChild.appendChild(card);

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
    App.container.innerHTML = '<div class="view"></div>'; App.container.firstChild.appendChild(card);

    setTimeout(async () => {
      connection = new P2PConnection(App);
      const ansStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      const base64 = Utils.encodeBase64Url(ansStr);
      card.innerHTML = '<h1 class="brand">Send Answer</h1><p>Scan this back to the Host</p>';
      App.renderQRCarousel(card, base64);
    }, 100);
  },

  // -------------------------
  // 2. LIVE CHAT UI LOGIC
  // -------------------------
  buildChatView() {
    const tpl = document.getElementById('tpl-chat').content.cloneNode(true);
    App.container.appendChild(tpl);

    // Tools
    document.getElementById('btn-end').onclick = () => { if(connection) connection.destroy(); App.renderState('IDLE'); };
    document.getElementById('btn-set-dir').onclick = async () => {
      const ok = await FileSystem.requestDirectory();
      if(ok) document.getElementById('btn-set-dir').style.color = '#10b981';
    };
    document.getElementById('btn-screen-cast').onclick = () => connection.toggleScreenCasting();

    // Drawing Canvas
    DrawController.init('chat-canvas', (cmdStr) => connection.sendPayload(cmdStr));
    const drawToolbar = document.getElementById('draw-toolbar');
    document.getElementById('btn-draw-toggle').onclick = () => {
      DrawController.toggle(!DrawController.isActive);
      drawToolbar.classList.toggle('hidden', !DrawController.isActive);
    };
    document.querySelectorAll('.color-swatch').forEach(el => {
      el.onclick = () => { document.querySelector('.color-swatch.active').classList.remove('active'); el.classList.add('active'); DrawController.setColor(el.dataset.color); };
    });
    document.getElementById('btn-draw-undo').onclick = () => DrawController.undo(true);
    document.getElementById('btn-draw-clear').onclick = () => DrawController.clear(true);
    document.getElementById('btn-draw-close').onclick = () => { DrawController.toggle(false); drawToolbar.classList.add('hidden'); };

    // Chat Inputs & Ghosting
    const input = document.getElementById('chat-input');
    let ghostTimeout;
    input.oninput = () => {
      if (App.settings.ghostTyping && connection) {
        connection.sendPayload(Protocol.createGhostTyping(input.value, true));
        clearTimeout(ghostTimeout);
        ghostTimeout = setTimeout(() => connection.sendPayload(Protocol.createGhostTyping('', false)), 2000);
      }
    };
    
    const sendBtn = document.getElementById('btn-send');
    const sendMsg = () => {
      const txt = input.value.trim();
      if (!txt || !connection) return;
      const msg = Protocol.createChatMessage(txt);
      connection.sendPayload(msg);
      if(App.settings.ghostTyping) connection.sendPayload(Protocol.createGhostTyping('', false));
      App.renderMessage(JSON.parse(msg), true);
      Synthesizer.playPop();
      input.value = '';
    };
    
    sendBtn.onclick = sendMsg;
    // Fix native keyboard glitch on mobile -> Shift+Enter for new line, Enter to send
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };

    // File Input Queue
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-file').onclick = () => fileInput.click();
    fileInput.onchange = (e) => { if(e.target.files.length && connection) connection.enqueueFiles(e.target.files); fileInput.value = ''; };

    // Read Receipt Trigger Area
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
      Synthesizer.init(); 
      App.renderState('CONNECTED', true);
      App.startHUD();
    } else if (status === 'ERR_PEER_DISCONNECTED' || status === 'CLOSED') {
      clearInterval(App.sessionTimer); clearInterval(App.metricsInterval);
      document.getElementById('metrics-hud').classList.add('hidden');
      alert(msg); App.renderState('IDLE', true);
    }
  },

  startHUD() {
    const hud = document.getElementById('metrics-hud');
    if(hud) hud.style.display = 'block';
    App.sessionStartTime = Date.now();
    App.sessionTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - App.sessionStartTime) / 1000);
      const timerEl = document.getElementById('session-timer');
      if(timerEl) timerEl.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }, 1000);

    App.metricsInterval = setInterval(() => {
      if(!connection) return;
      const current = connection.getMetrics();
      const diffRx = current.rxBytes - App.lastMetrics.rxBytes;
      const diffTx = current.txBytes - App.lastMetrics.txBytes;
      const speedEl = document.getElementById('transfer-speed');
      if(speedEl) speedEl.textContent = `${((diffRx + diffTx) / (1024 * 1024)).toFixed(2)} MB/s`;
      App.lastMetrics = { ...current };
      
      let usage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
      usage.up += diffTx; usage.down += diffRx;
      localStorage.setItem('wchat_data', JSON.stringify(usage));
      const countEl = document.getElementById('data-counter');
      if(countEl) countEl.textContent = `${(usage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(usage.down/(1024*1024)).toFixed(2)} MB ⬇`;
    }, 1000);
  },

  buildChatView() {
    const tpl = document.getElementById('tpl-chat').content.cloneNode(true);
    App.container.appendChild(tpl);

    // End chat
    document.getElementById('btn-end').onclick = () => { if(connection) connection.destroy(); App.renderState('IDLE'); };

    // Dice Menu Logic
    const diceBtn = document.getElementById('btn-dice');
    const diceMenu = document.getElementById('dice-menu');
    diceBtn.onclick = (e) => { e.stopPropagation(); diceMenu.classList.toggle('active'); };
    
    document.addEventListener('click', (e) => {
      if(diceMenu && !diceMenu.contains(e.target) && e.target !== diceBtn) {
        diceMenu.classList.remove('active');
      }
    });

    // Menu Actions
    document.getElementById('btn-set-dir').onclick = async () => {
      diceMenu.classList.remove('active');
      const ok = await FileSystem.requestDirectory();
      if(ok) document.getElementById('btn-set-dir').style.color = '#10b981';
    };
    
    document.getElementById('btn-screen-cast').onclick = () => {
      diceMenu.classList.remove('active');
      connection.toggleScreenCasting();
    };

    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-file').onclick = () => { diceMenu.classList.remove('active'); fileInput.click(); };
    fileInput.onchange = (e) => { if(e.target.files.length && connection) connection.enqueueFiles(e.target.files); fileInput.value = ''; };

    // Drawing Canvas
    DrawController.init('chat-canvas', (cmdStr) => connection.sendPayload(cmdStr));
    const drawToolbar = document.getElementById('draw-toolbar');
    
    document.getElementById('btn-draw-toggle').onclick = () => {
      diceMenu.classList.remove('active');
      DrawController.toggle(!DrawController.isActive);
      drawToolbar.classList.toggle('hidden', !DrawController.isActive);
    };
    
    document.querySelectorAll('.color-swatch').forEach(el => {
      el.onclick = () => { document.querySelector('.color-swatch.active').classList.remove('active'); el.classList.add('active'); DrawController.setColor(el.dataset.color); };
    });
    document.getElementById('btn-draw-undo').onclick = () => DrawController.undo(true);
    document.getElementById('btn-draw-clear').onclick = () => DrawController.clear(true);
    document.getElementById('btn-draw-close').onclick = () => { DrawController.toggle(false); drawToolbar.classList.add('hidden'); };

    // Chat Inputs & Ghosting
    const input = document.getElementById('chat-input');
    let ghostTimeout;
    input.oninput = () => {
      if (App.settings.ghostTyping && connection) {
        connection.sendPayload(Protocol.createGhostTyping(input.value, true));
        clearTimeout(ghostTimeout);
        ghostTimeout = setTimeout(() => connection.sendPayload(Protocol.createGhostTyping('', false)), 2000);
      }
    };
    
    const sendBtn = document.getElementById('btn-send');
    const sendMsg = () => {
      const txt = input.value.trim();
      if (!txt || !connection) return;
      const msg = Protocol.createChatMessage(txt);
      connection.sendPayload(msg);
      if(App.settings.ghostTyping) connection.sendPayload(Protocol.createGhostTyping('', false));
      App.renderMessage(JSON.parse(msg), true);
      Synthesizer.playPop();
      input.value = '';
    };
    
    sendBtn.onclick = sendMsg;
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };

    // Read Receipt Trigger Area
    App.receiptObserver = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting && ent.target.dataset.status === 'deliv') {
          ent.target.dataset.status = 'seen';
          if(connection) connection.sendPayload(Protocol.createReceipt(ent.target.id, 2));
        }
      });
    }, { root: document.getElementById('chat-log'), threshold: 0.5 });
  }
  // -------------------------
  // 3. HARDWARE ROUTING ENGINE
  // -------------------------
  onMessageRouter(msg) {
    if (msg.type === Protocol.TYPES.CHAT) {
      App.renderMessage(msg, false);
      connection.sendPayload(Protocol.createReceipt(msg.id, 1)); 
      Synthesizer.playSwoosh();
    }
    else if (msg.type === Protocol.TYPES.GHOST) App.handleGhost(msg);
    else if (msg.type === Protocol.TYPES.RECEIPT) App.updateReceipt(msg.id, msg.status);
    else if ([Protocol.TYPES.DRAW, Protocol.TYPES.DRAW_UNDO, Protocol.TYPES.DRAW_CLEAR].includes(msg.type)) DrawController.handleNetworkCommand(msg);
    else if (msg.type === Protocol.TYPES.FILE_START) App.onIncomingFileStart(msg);
    else if (msg.type === Protocol.TYPES.FILE_END) App.onIncomingFileEnd(msg.id);
    else if (msg.type === Protocol.TYPES.FILE_CANCEL) App.onIncomingFileEnd(msg.id, true);
    else if (msg.type.startsWith('screen_')) connection.handleScreenSignal(msg);
  },

  renderMessage(msg, isSelf) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', `msg-wrap ${isSelf ? 'self' : 'peer'}`);
    wrap.id = msg.id;
    wrap.innerHTML = `
      <div class="msg-bubble">${msg.text}</div>
      <div class="msg-meta">
        ${new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
        ${isSelf ? `<span class="msg-ticks" id="tick-${msg.id}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}
      </div>`;
    
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    if (!isSelf) { wrap.dataset.status = 'deliv'; App.receiptObserver.observe(wrap); }
  },

  handleGhost(msg) {
    const cont = document.getElementById('ghost-typing-container');
    const txt = document.getElementById('ghost-text-preview');
    if (msg.active && msg.text) {
      cont.classList.remove('hidden'); txt.textContent = msg.text;
      document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
    } else { cont.classList.add('hidden'); txt.textContent = ''; }
  },

  updateReceipt(id, status) {
    const tick = document.getElementById(`tick-${id}`);
    if(!tick) return;
    if(status === 1) tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M18 6l-9 11-4-5"/><path d="M22 6l-9 11"/></svg>';
    if(status === 2) tick.classList.add('seen');
  },

  async onIncomingFileStart(msg) {
    let stream = null;
    if (FileSystem.sessionFolder) stream = await FileSystem.createWritable(msg.name);
    App.activeIncomingFile = { id: msg.id, name: msg.name, size: msg.size, chunks: [], stream: stream, received: 0 };
    App.onFileTransferStart(msg.id, msg.name, msg.size, false);
  },

  async onBinaryChunkReceived(buffer) {
    const f = App.activeIncomingFile;
    if(!f) return;
    f.received += buffer.byteLength;
    if (f.stream) await f.stream.write(buffer); else f.chunks.push(buffer);
    App.onFileTransferProgress(f.id, (f.received / f.size) * 100);
  },

  async onIncomingFileEnd(id, aborted = false) {
    const f = App.activeIncomingFile;
    if(!f || f.id !== id) return;
    if (f.stream) await f.stream.close();
    else if (!aborted) {
      const blob = new Blob(f.chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
    }
    App.onFileTransferComplete(id, null, !aborted);
    App.activeIncomingFile = null;
  },

  onFileTransferStart(id, name, size, isUpload) {
    const log = document.getElementById('chat-log');
    const box = Utils.createElement('div', '', `msg-wrap ${isUpload ? 'self' : 'peer'}`);
    box.id = 'ui-f-' + id;
    box.innerHTML = `<div class="msg-bubble file-bubble" style="width: 240px;">
      <strong style="display:block; overflow:hidden; text-overflow:ellipsis;">${name}</strong>
      <small>${(size/(1024*1024)).toFixed(2)} MB</small>
      <div style="height:6px; background:var(--border); border-radius:3px; margin-top:8px; overflow:hidden;">
        <div id="prog-${id}" style="height:100%; width:0%; background:var(--primary); transition:width 0.1s;"></div>
      </div>
      <small id="text-${id}" style="display:block; margin-top:4px;">${isUpload ? 'Sending' : 'Receiving'}...</small>
    </div>`;
    log.appendChild(box); log.scrollTop = log.scrollHeight;
  },

  onFileTransferProgress(id, percent) {
    const bar = document.getElementById(`prog-${id}`);
    const txt = document.getElementById(`text-${id}`);
    if(bar) bar.style.width = `${percent}%`;
    if(txt) txt.textContent = `Transferring... ${Math.floor(percent)}%`;
  },

  onFileTransferComplete(id, url, success) {
    const txt = document.getElementById(`text-${id}`);
    const bar = document.getElementById(`prog-${id}`);
    if(success && bar) bar.style.width = '100%';
    if(txt) txt.textContent = success ? (FileSystem.sessionFolder ? 'Saved to Disk ✅' : 'Received ✅') : '❌ Cancelled';
  },

  onScreenCastReceived(stream) {
    let video = document.getElementById('remote-screen');
    if (!video) {
      video = document.createElement('video'); video.id = 'remote-screen';
      video.autoplay = true; video.style.width = '100%'; video.style.borderRadius = '12px';
      video.style.marginTop = '10px'; video.style.boxShadow = '0 5px 15px rgba(0,0,0,0.1)';
      document.getElementById('chat-log').appendChild(video);
    }
    video.srcObject = stream;
  }
};

// Start application immediately upon window ready
window.onload = () => App.init();
