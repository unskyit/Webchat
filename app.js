// app.js - UI State Machine and Render Logic

const STATE = {
  IDLE: 'IDLE',
  HOST_WAITING: 'HOST_WAITING',
  GUEST_JOINING: 'GUEST_JOINING',
  GUEST_ANSWERING: 'GUEST_ANSWERING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR'
};

let currentState = STATE.IDLE;
let connection = null;

const App = {
  container: document.getElementById('app-container'),

  init() {
    // Check if URL has a payload (Guest joining via link)
    if (window.location.hash.startsWith('#join=')) {
      const payloadStr = Utils.decodeBase64Url(window.location.hash.substring(6));
      // Clean URL immediately for privacy
      window.history.replaceState(null, '', window.location.pathname);
      
      if (payloadStr) {
        const signal = Protocol.validateSignal(payloadStr, 'offer');
        if (signal) {
          App.handleGuestJoin(signal);
          return;
        } else {
          App.renderError("This connection link is invalid or has expired.");
          return;
        }
      }
    }
    App.renderIdle();
  },

  setState(newState) {
    currentState = newState;
    App.container.innerHTML = ''; // Clear DOM safely
  },

  // ================= VIEW: IDLE =================
  renderIdle() {
    App.setState(STATE.IDLE);
    
    const view = Utils.createElement('div', '', 'view');
    view.appendChild(Utils.createElement('h1', 'P2P CHAT'));
    view.appendChild(Utils.createElement('p', 'Private. Direct. Simple.'));

    const btnCreate = Utils.createElement('button', 'Create a room');
    btnCreate.onclick = () => App.handleHostCreate();
    
    const btnJoin = Utils.createElement('button', 'Join a room', 'secondary');
    btnJoin.onclick = () => {
      const code = prompt("Paste the connection code here:");
      if (code) {
        const decoded = Utils.decodeBase64Url(code);
        const signal = decoded ? Protocol.validateSignal(decoded, 'offer') : null;
        if (signal) App.handleGuestJoin(signal);
        else alert("Invalid or expired code.");
      }
    };

    view.appendChild(btnCreate);
    view.appendChild(btnJoin);
    App.container.appendChild(view);
  },

  // ================= HOST LOGIC =================
  async handleHostCreate() {
    App.setState(STATE.HOST_WAITING);
    const view = Utils.createElement('div', '', 'view');
    view.appendChild(Utils.createElement('h1', 'Generating room...'));
    App.container.appendChild(view);

    connection = new P2PConnection(App.onConnectionStateChange, App.onChatMessage);
    
    try {
      const offerStr = await connection.generateOffer();
      const base64Offer = Utils.encodeBase64Url(offerStr);
      const inviteLink = `${window.location.origin}${window.location.pathname}#join=${base64Offer}`;

      App.setState(STATE.HOST_WAITING);
      const waitView = Utils.createElement('div', '', 'view');
      waitView.appendChild(Utils.createElement('h1', 'Your room is ready'));
      waitView.appendChild(Utils.createElement('p', 'Share this connection with a friend'));

      const btnCopy = Utils.createElement('button', 'Copy link');
      btnCopy.onclick = () => {
        navigator.clipboard.writeText(inviteLink);
        btnCopy.textContent = 'Copied!';
        setTimeout(() => btnCopy.textContent = 'Copy link', 2000);
      };
      waitView.appendChild(btnCopy);

      if (navigator.share) {
        const btnShare = Utils.createElement('button', 'Share', 'secondary');
        btnShare.onclick = () => navigator.share({ title: 'P2P Chat', url: inviteLink });
        waitView.appendChild(btnShare);
      }

      waitView.appendChild(Utils.createElement('span', 'Waiting for someone to join...', 'label'));
      
      const statusDiv = Utils.createElement('div', '', 'status');
      statusDiv.appendChild(Utils.createElement('div', '', 'dot'));
      statusDiv.appendChild(Utils.createElement('span', 'Connecting'));
      waitView.appendChild(statusDiv);

      const labelPaste = Utils.createElement('span', 'When they reply, paste their code here:', 'label');
      labelPaste.style.marginTop = '20px';
      waitView.appendChild(labelPaste);

      const inputAnswer = Utils.createElement('input');
      inputAnswer.placeholder = "Paste answer code here...";
      inputAnswer.oninput = async (e) => {
        const decoded = Utils.decodeBase64Url(e.target.value.trim());
        if (!decoded) return;
        const answerSignal = Protocol.validateSignal(decoded, 'answer');
        if (answerSignal) {
          try {
            await connection.acceptAnswer(answerSignal);
            inputAnswer.value = 'Connecting...';
            inputAnswer.disabled = true;
          } catch (err) {
            alert("Failed to connect: " + err.message);
          }
        }
      };
      waitView.appendChild(inputAnswer);

      App.container.appendChild(waitView);
    } catch (e) {
      App.renderError("Failed to create room. Check network permissions.");
    }
  },

  // ================= GUEST LOGIC =================
  async handleGuestJoin(offerSignal) {
    App.setState(STATE.GUEST_ANSWERING);
    const view = Utils.createElement('div', '', 'view');
    view.appendChild(Utils.createElement('h1', 'Joining room...'));
    App.container.appendChild(view);

    connection = new P2PConnection(App.onConnectionStateChange, App.onChatMessage);

    try {
      const answerStr = await connection.acceptOfferAndGenerateAnswer(offerSignal);
      const base64Answer = Utils.encodeBase64Url(answerStr);

      App.setState(STATE.GUEST_ANSWERING);
      const ansView = Utils.createElement('div', '', 'view');
      ansView.appendChild(Utils.createElement('h1', 'Connection secured'));
      ansView.appendChild(Utils.createElement('p', 'Send this code back to the host'));

      const codeBox = Utils.createElement('textarea');
      codeBox.value = base64Answer;
      codeBox.readOnly = true;
      codeBox.rows = 4;
      ansView.appendChild(codeBox);

      const btnCopy = Utils.createElement('button', 'Copy Code');
      btnCopy.onclick = () => {
        navigator.clipboard.writeText(base64Answer);
        btnCopy.textContent = 'Copied!';
        setTimeout(() => btnCopy.textContent = 'Copy Code', 2000);
      };
      ansView.appendChild(btnCopy);

      const statusDiv = Utils.createElement('div', '', 'status');
      statusDiv.appendChild(Utils.createElement('div', '', 'dot'));
      statusDiv.appendChild(Utils.createElement('span', 'Waiting for host to accept...'));
      ansView.appendChild(statusDiv);

      App.container.appendChild(ansView);
    } catch (e) {
      App.renderError("Failed to generate answer. The link might be invalid.");
    }
  },

  // ================= CHAT UI =================
  renderChat() {
    App.setState(STATE.CONNECTED);
    
    const view = Utils.createElement('div', '', 'view');
    view.style.justifyContent = 'flex-start';

    const header = Utils.createElement('div');
    header.id = 'chat-header';
    header.appendChild(Utils.createElement('h2', 'Encrypted Chat'));
    
    const btnEnd = Utils.createElement('button', 'End Chat');
    btnEnd.id = 'btn-end';
    btnEnd.onclick = () => {
      if(connection) connection.destroy();
      App.renderIdle();
    };
    header.appendChild(btnEnd);
    view.appendChild(header);

    const log = Utils.createElement('div');
    log.id = 'chat-log';
    const sysMsg = Utils.createElement('div', 'Connection established. Messages are peer-to-peer.', 'msg system');
    log.appendChild(sysMsg);
    view.appendChild(log);

    const inputContainer = Utils.createElement('div');
    inputContainer.id = 'chat-input-container';
    
    const inputField = Utils.createElement('input');
    inputField.placeholder = "Message...";
    inputField.autocomplete = "off";
    
    const btnSend = Utils.createElement('button', 'Send');
    btnSend.id = 'btn-send';

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

    inputContainer.appendChild(inputField);
    inputContainer.appendChild(btnSend);
    view.appendChild(inputContainer);

    App.container.appendChild(view);
    inputField.focus();
  },

  appendMessage(text, isSelf) {
    if (currentState !== STATE.CONNECTED) return;
    const log = document.getElementById('chat-log');
    if (!log) return;
    
    // Limits history in DOM to prevent memory bloat
    if (log.children.length > 200) log.removeChild(log.firstChild);

    // Uses textContent intrinsically preventing XSS
    const msgEl = Utils.createElement('div', text, isSelf ? 'msg self' : 'msg peer');
    log.appendChild(msgEl);
    log.scrollTop = log.scrollHeight;
  },

  // ================= EVENT DELEGATION =================
  onConnectionStateChange(status, message = "") {
    if (status === 'CONNECTED') {
      App.renderChat();
    } else if (status === 'CLOSED' || status.startsWith('ERR_')) {
      App.renderError(message || "Connection interrupted.");
    }
  },

  onChatMessage(msgObj) {
    App.appendMessage(msgObj.text, false);
  },

  renderError(message) {
    App.setState(STATE.ERROR);
    if(connection) connection.destroy();
    
    const view = Utils.createElement('div', '', 'view');
    view.appendChild(Utils.createElement('h1', 'Disconnected'));
    view.appendChild(Utils.createElement('p', message));
    
    const btnHome = Utils.createElement('button', 'Start a new chat');
    btnHome.onclick = () => App.renderIdle();
    view.appendChild(btnHome);
    
    App.container.appendChild(view);
  }
};

// Boot
window.onload = App.init;
