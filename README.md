<div align="center">
  
  # 🌌 Webchat: The Ultimate Serverless P2P Ecosystem

  <p align="center">
    <strong>An air-gapped, WebRTC-powered communication protocol disguised as a beautiful chat app.</strong>
  </p>

  ![Version](https://img.shields.io/badge/Build-v7.0_Stable-2563eb?style=for-the-badge&logo=appveyor)
  ![Architecture](https://img.shields.io/badge/Architecture-100%25_Serverless-10b981?style=for-the-badge&logo=serverless)
  ![Security](https://img.shields.io/badge/Encryption-AES--256_DTLS-f59e0b?style=for-the-badge&logo=lock)
  ![PWA](https://img.shields.io/badge/PWA-Ready-8b5cf6?style=for-the-badge&logo=pwa)
  ![License](https://img.shields.io/badge/License-Personal_Use_Only-ef4444?style=for-the-badge)

  <br />

  <img src="https://img.shields.io/badge/Vanilla_JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JS" />
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white" alt="CSS" />
  <img src="https://img.shields.io/badge/WebRTC-333333?style=flat-square&logo=webrtc&logoColor=white" alt="WebRTC" />
  <img src="https://img.shields.io/badge/Service_Workers-4285F4?style=flat-square&logo=google-chrome&logoColor=white" alt="SW" />

</div>

---

## ⚡ Core Philosophy

Webchat is not just a messaging app; it is a demonstration of extreme client-side engineering. By pushing WebRTC data channels, the Web Audio API, Canvas 2D, and File System APIs to their absolute limits, this application functions entirely without a backend database or messaging server.

---

## 🎴 Feature Cards

<table>
  <tr>
    <td width="33%" align="center">
      <h2>📡<br>Air-Gapped QR<br>Fountain</h2>
      <p>Connect completely offline. The app slices connection keys into dynamic animated QR carousels (15+ chunks) streaming at 400ms for frictionless optical pairing.</p>
    </td>
    <td width="33%" align="center">
      <h2>🎨<br>Dual-Engine<br>Canvas</h2>
      <p>Switch between <strong>Draw on Chat</strong> (overlay) and <strong>Draw on Canvas</strong> (solid isolation). Includes live multi-peer syncing, high-res downloads, and Web Share API.</p>
    </td>
    <td width="33%" align="center">
      <h2>🗂️<br>Direct-to-Disk<br>Streaming</h2>
      <p>Bypass RAM limits. Using the File System Access API, incoming files stream directly to a designated local folder, allowing infinite gigabyte transfers without crashing.</p>
    </td>
  </tr>
  <tr>
    <td width="33%" align="center">
      <h2>🔋<br>Silent Audio<br>Keep-Alive</h2>
      <p>Maintains PWA background connection using a 1-sample inaudible audio loop hack, tricking mobile OS limiters into keeping WebRTC active when minimized.</p>
    </td>
    <td width="33%" align="center">
      <h2>📱<br>True Black<br>OLED Mode</h2>
      <p>Dynamic <code>theme-color</code> manipulation and strict <code>#000000</code> hex values save OLED battery life while protecting eyes with contrast-balanced blue typography.</p>
    </td>
    <td width="33%" align="center">
      <h2>💬<br>Contextual<br>Smart UX</h2>
      <p>Single emojis automatically scale 300%. Features WhatsApp-style targeted replies, smart scroll-down badges, and ghost-typing text previews.</p>
    </td>
  </tr>
</table>

---

## 📐 Architecture & Flowcharts

How exactly does a serverless app connect? Webchat utilizes two distinct architectural bridges, mapped out below in zero-dependency ASCII flowcharts.

### 1. The Cloud OTP Bridge (Online Mode)
*Uses an ephemeral Google Apps Script solely for an initial 5-second handshake.*

```text
[ Peer A (Host) ]                             [ Signaling Script ]                            [ Peer B (Guest) ]
       │                                               │                                              │
       │ 1. Generate WebRTC Offer (SDP)                │                                              │
       │──────────────────────────────────────────────>│                                              │
       │    POST Offer with PIN (e.g. "secret45")      │                                              │
       │                                               │ (Holds data for 5s)                          │
       │                                               │<─────────────────────────────────────────────│
       │                                               │         GET Offer using PIN                  │
       │                                               │                                              │
       │                                               │               2. Apply Offer, Generate Answer│
       │                                               │<─────────────────────────────────────────────│
       │                                               │         POST Answer to PIN                   │
       │<──────────────────────────────────────────────│                                              │
       │              GET Answer                       │                                              │
       │                                               X (Connection Abandoned)                       │
       │                                                                                              │
       │====================== 3. Secure P2P DTLS Pipe Established ===================================│
       │<────────────────────────────────────────────────────────────────────────────────────────────>│
       │                            Direct Encrypted Chat & Files                                     │
