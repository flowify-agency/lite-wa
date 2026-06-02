const express = require('express');
const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Global crash mitigation for Puppeteer and third-party unhandled errors (e.g. "Execution context was destroyed" during phone logout)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Alert] Caught Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error('[Process Alert] Caught Uncaught Exception:', err.message, 'at:', origin);
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || 'Narzo50pro@gmail.com';

// Active clients map to track sessions
const clients = {};

// In-memory array to log all incoming and outgoing messages (capped at 200 items)
const messagesLog = [];

// In-memory message queues to hold messages for non-ready client sessions
const messageQueue = {};

// Helper to process held/queued messages for a client session when it becomes READY
const processQueue = async (clientId) => {
  const session = clients[clientId];
  if (!session || session.state !== 'READY') return;

  const queue = messageQueue[clientId] || [];
  if (queue.length === 0) return;

  console.log(`[WhatsApp API] [${clientId}] Starting transmission of ${queue.length} held messages...`);

  // To prevent race conditions, copy the queue and clear the original
  const messagesToProcess = [...queue];
  messageQueue[clientId] = [];

  for (const msgData of messagesToProcess) {
    try {
      // Small staggered delay between sending to be gentle on Puppeteer & WhatsApp rate limits
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Re-check session state in case it disconnected mid-processing
      if (session.state !== 'READY') {
        console.log(`[WhatsApp API] [${clientId}] Session disconnected during queue processing! Re-queueing remaining ${messagesToProcess.slice(messagesToProcess.indexOf(msgData)).length} messages.`);
        messageQueue[clientId] = [...messagesToProcess.slice(messagesToProcess.indexOf(msgData)), ...messageQueue[clientId]];
        break;
      }

      const { number, message, mediaUrl, mediaBase64, mimetype, filename, latitude, longitude, name, address } = msgData;

      let cleaned = number.replace(/\D/g, '');
      let chatId;
      const client = session.client;
      if (number.endsWith('@c.us') || number.endsWith('@g.us')) {
        chatId = number;
      } else {
        try {
          const numberId = await client.getNumberId(cleaned);
          if (numberId) {
            chatId = numberId._serialized;
          } else {
            chatId = `${cleaned}@c.us`;
          }
        } catch (e) {
          chatId = `${cleaned}@c.us`;
        }
      }
      const hasLocation = latitude !== undefined && longitude !== undefined;
      let response;

      if (hasLocation) {
        const locationObj = new Location(parseFloat(latitude), parseFloat(longitude), { name: name || '', address: address || '' });
        response = await client.sendMessage(chatId, locationObj);
      } else if (mediaUrl) {
        const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
        response = await client.sendMessage(chatId, media, message ? { caption: message } : {});
      } else if (mediaBase64) {
        const media = new MessageMedia(mimetype, mediaBase64, filename || 'attachment');
        response = await client.sendMessage(chatId, media, message ? { caption: message } : {});
      } else {
        response = await client.sendMessage(chatId, message);
      }

      console.log(`[WhatsApp API] [${clientId}] Held message successfully sent to ${chatId}`);

      // Log outgoing message in-memory
      messagesLog.unshift({
        id: response.id._serialized,
        timestamp: new Date().toLocaleTimeString(),
        clientId: clientId,
        type: 'outgoing',
        from: session.clientInfo ? session.clientInfo.number : 'Self',
        to: chatId.replace('@c.us', '').replace('@g.us', ''),
        body: message || (mediaUrl ? `[Media URL: ${mediaUrl}]` : mediaBase64 ? '[Base64 Media]' : '[Location Card]'),
        status: 'SENT'
      });

      if (messagesLog.length > 200) {
        messagesLog.pop();
      }

    } catch (err) {
      console.error(`[WhatsApp API] [${clientId}] Failed to send held message to ${msgData.number}:`, err);
    }
  }
};

// Helper to check if a session folder exists on disk
const getSessionFolder = (clientId) => {
  return path.resolve(__dirname, '.wwebjs_auth', `session-${clientId}`);
};

// Initialize WhatsApp client with robust Puppeteer flags
const getOrInitializeClient = async (clientId) => {
  if (clients[clientId]) {
    return clients[clientId];
  }

  console.log(`[WhatsApp API] [${clientId}] Provisioning new Puppeteer instance...`);
  
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: clientId, // Custom session identifier
      dataPath: path.resolve(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions'
      ]
    }
  });

  const clientSession = {
    client,
    state: 'INITIALIZING', // INITIALIZING, QR_REQUIRED, AUTHENTICATED, READY, FAILED, DISCONNECTED
    qrData: null,
    qrBase64: null,
    clientInfo: null,
    readyTimeout: null
  };

  clients[clientId] = clientSession;

  // Setup event listeners
  client.on('qr', async (qr) => {
    clientSession.state = 'QR_REQUIRED';
    clientSession.qrData = qr;
    
    // Generate QR in Terminal
    console.log(`\n--- SCAN THE QR CODE BELOW FOR CLIENT: ${clientId} ---`);
    qrcodeTerminal.generate(qr, { small: true });
    console.log('---------------------------------------------------\n');

    // Generate Base64 QR Image for API/Web UI
    try {
      clientSession.qrBase64 = await QRCode.toDataURL(qr, {
        margin: 2,
        width: 300,
        color: {
          dark: '#1e293b', // slate-800
          light: '#ffffff'
        }
      });
    } catch (err) {
      console.error(`[${clientId}] Failed to generate Base64 QR Code:`, err);
    }
  });

  client.on('authenticated', () => {
    clientSession.state = 'AUTHENTICATED';
    clientSession.qrData = null;
    clientSession.qrBase64 = null;
    console.log(`[WhatsApp API] [${clientId}] Authentication successful! Syncing session...`);

    // Setup auto-recovery watchdog
    if (clientSession.readyTimeout) clearTimeout(clientSession.readyTimeout);
    clientSession.readyTimeout = setTimeout(async () => {
      if (clientSession.state === 'AUTHENTICATED') {
        console.log(`[WhatsApp API] [${clientId}] Sync is taking longer. Performing background page refresh...`);
        try {
          if (client.pupPage) {
            await client.pupPage.reload();
            console.log(`[WhatsApp API] [${clientId}] Page refreshed successfully.`);
          }
        } catch (err) {
          console.error(`[WhatsApp API] [${clientId}] Page refresh failed:`, err.message);
        }
      }
    }, 15000); // 15 seconds
  });

  client.on('auth_failure', async (msg) => {
    clientSession.state = 'FAILED';
    if (clientSession.readyTimeout) clearTimeout(clientSession.readyTimeout);
    console.error(`[WhatsApp API] [${clientId}] Authentication failed:`, msg);
    
    console.log(`[WhatsApp API] [${clientId}] Purging invalid/expired session cache and re-provisioning fresh client...`);
    try {
      await client.destroy();
    } catch (destroyErr) {
      console.error(`[WhatsApp API] [${clientId}] Error destroying client during auth failure cleanup:`, destroyErr.message);
    }
    
    const sessionPath = getSessionFolder(clientId);
    if (fs.existsSync(sessionPath)) {
      try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`[WhatsApp API] [${clientId}] Expired/invalid session cache directory removed cleanly.`);
      } catch (rmErr) {
        console.error(`[WhatsApp API] [${clientId}] Failed to remove session cache directory:`, rmErr.message);
      }
    }
    
    // Remove from in-memory clients registry to trigger fresh provisioning
    delete clients[clientId];
    
    // Boot a fresh client instance to get a new QR code
    getOrInitializeClient(clientId).catch(err => {
      console.error(`[WhatsApp API] [${clientId}] Failed to re-provision fresh client session after auth failure:`, err);
    });
  });

  client.on('ready', () => {
    clientSession.state = 'READY';
    if (clientSession.readyTimeout) clearTimeout(clientSession.readyTimeout);
    clientSession.clientInfo = {
      number: client.info.wid.user,
      pushname: client.info.pushname
    };
    console.log(`[WhatsApp API] [${clientId}] Client is fully READY as +${clientSession.clientInfo.number} (${clientSession.clientInfo.pushname})!`);
    
    // Process any held/queued messages for this client!
    processQueue(clientId);
  });

  client.on('message', async (msg) => {
    console.log(`[WhatsApp API] [${clientId}] Received message from ${msg.from}: ${msg.body}`);
    messagesLog.unshift({
      id: msg.id._serialized,
      timestamp: new Date().toLocaleTimeString(),
      clientId: clientId,
      type: 'incoming',
      from: msg.from.replace('@c.us', '').replace('@g.us', ''),
      to: msg.to.replace('@c.us', '').replace('@g.us', ''),
      body: msg.body || '[Media/Attachment]',
      status: 'RECEIVED'
    });

    if (messagesLog.length > 200) {
      messagesLog.pop();
    }
  });

  client.on('disconnected', async (reason) => {
    clientSession.state = 'DISCONNECTED';
    if (clientSession.readyTimeout) clearTimeout(clientSession.readyTimeout);
    clientSession.clientInfo = null;
    clientSession.qrData = null;
    clientSession.qrBase64 = null;
    console.log(`[WhatsApp API] [${clientId}] Client was disconnected (reason: ${reason}). Cleaning up...`);
    
    try {
      // 1. Destroy the old Puppeteer instance cleanly to release file locks
      await client.destroy();
      console.log(`[WhatsApp API] [${clientId}] Old Puppeteer client instance destroyed successfully.`);
    } catch (destroyErr) {
      console.error(`[WhatsApp API] [${clientId}] Error destroying client during disconnect:`, destroyErr.message);
    }

    // 2. If it was a logout or navigation disconnect (unlinking), remove the cache folder to prevent corrupted session loads
    if (reason === 'LOGOUT' || reason === 'NAVIGATION') {
      const sessionPath = getSessionFolder(clientId);
      if (fs.existsSync(sessionPath)) {
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log(`[WhatsApp API] [${clientId}] Session cache directory removed cleanly after disconnect (${reason}).`);
        } catch (rmErr) {
          console.error(`[WhatsApp API] [${clientId}] Failed to remove session cache directory:`, rmErr.message);
        }
      }
    }

    // 3. Re-initialize a fresh client instance to get a new QR code scanner
    console.log(`[WhatsApp API] [${clientId}] Re-provisioning a fresh client session...`);
    
    // Delete the active clients map reference so getOrInitializeClient will create a brand new client instance!
    delete clients[clientId];
    
    // Call getOrInitializeClient to spin up a fresh client session cleanly
    getOrInitializeClient(clientId).catch(err => {
      console.error(`[WhatsApp API] [${clientId}] Failed to re-provision fresh client session:`, err);
    });
  });

  client.initialize().catch(async (err) => {
    console.error(`[WhatsApp API] [${clientId}] Failed to initialize client:`, err.message);
    
    // Self-heal: If initialization fails due to Puppeteer context destruction or protocol errors (corrupted session cache), purge and retry fresh.
    if (err.message.includes('destroyed') || err.message.includes('Protocol error') || err.message.includes('Session')) {
      console.log(`[WhatsApp API] [${clientId}] Session cache folder appears to be corrupted or logged out. Purging and retrying connection...`);
      try {
        await client.destroy();
      } catch (destroyErr) {}
      
      const sessionPath = getSessionFolder(clientId);
      if (fs.existsSync(sessionPath)) {
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.log(`[WhatsApp API] [${clientId}] Corrupted session cache directory deleted successfully.`);
        } catch (rmErr) {
          console.error(`[WhatsApp API] [${clientId}] Failed to purge corrupted session directory:`, rmErr.message);
        }
      }
      
      // Delete from client registry and spawn a fresh client cleanly
      delete clients[clientId];
      getOrInitializeClient(clientId).catch(retryErr => {
        console.error(`[WhatsApp API] [${clientId}] Failed to re-provision clean client during self-healing:`, retryErr);
      });
    } else {
      clientSession.state = 'FAILED';
    }
  });

  return clientSession;
};

// Middleware for API Key Authentication
const authenticate = (req, res, next) => {
  if (!API_KEY) return next();
  
  const headerKey = req.headers['x-api-key'];
  const queryKey = req.query.key;
  
  if (headerKey === API_KEY || queryKey === API_KEY) {
    return next();
  }
  
  return res.status(401).json({ 
    success: false, 
    error: 'Unauthorized: Missing or invalid X-API-Key' 
  });
};

// Endpoint to Register / Provision a new client dynamically
app.post('/register', authenticate, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId || !clientId.trim()) {
    return res.status(400).json({ success: false, error: 'Bad Request: "clientId" is required.' });
  }

  // Clean clientId to make it file-path and URL friendly
  const cleanId = clientId.trim().replace(/[^a-zA-Z0-9_\-+@.]/g, '');
  if (!cleanId) {
    return res.status(400).json({ success: false, error: 'Bad Request: "clientId" contains invalid characters.' });
  }

  // Ensure the cleaned ID is exactly a 10-digit phone number
  const isTenDigit = /^\d{10}$/.test(cleanId);
  if (!isTenDigit) {
    return res.status(400).json({ success: false, error: 'Bad Request: "clientId" must be exactly a 10-digit phone number.' });
  }

  if (clients[cleanId]) {
    return res.status(400).json({ success: false, error: `Bad Request: Session already active for client ID: ${cleanId}` });
  }

  try {
    await getOrInitializeClient(cleanId);
    return res.status(200).json({
      success: true,
      message: `Session initialization started for client ID: ${cleanId}.`,
      statusUrl: `http://localhost:${PORT}/status?clientId=${cleanId}`
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to initialize session', details: err.message });
  }
});

// Endpoint to Disconnect / Deregister a client session
app.post('/disconnect', authenticate, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'Bad Request: "clientId" is required.' });
  }

  // Clean and sanitize to prevent space and character issues
  const cleanId = clientId.trim().replace(/[^a-zA-Z0-9_\-+@.]/g, '');
  if (!/^\d{10}$/.test(cleanId)) {
    return res.status(400).json({ success: false, error: 'Bad Request: "clientId" must be exactly a 10-digit phone number.' });
  }

  const session = clients[cleanId];
  if (!session) {
    return res.status(404).json({ success: false, error: `Not Found: No active session for client ID: ${cleanId}` });
  }

  console.log(`[WhatsApp API] [${cleanId}] Disconnecting and destroying session...`);
  try {
    if (session.readyTimeout) clearTimeout(session.readyTimeout);
    
    // Destroy Puppeteer client instance cleanly
    await session.client.destroy();
    
    // Remove from in-memory registry
    delete clients[cleanId];
    
    // Clean up session folder from disk
    const sessionPath = getSessionFolder(cleanId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`[WhatsApp API] [${cleanId}] Session cache directory removed cleanly.`);
    }

    return res.status(200).json({ success: true, message: `Session ${cleanId} disconnected and fully purged.` });
  } catch (err) {
    console.error(`[WhatsApp API] [${cleanId}] Error during disconnect:`, err);
    return res.status(500).json({ success: false, error: 'Failed to disconnect session', details: err.message });
  }
});

// GET /messages - Retrieve full in-memory message logs
app.get('/messages', authenticate, (req, res) => {
  return res.json({ success: true, logs: messagesLog });
});

// GET /status - Unified Multi-Client Dev Dashboard & JSON endpoint
app.get('/status', (req, res) => {
  const isHtmlRequested = req.accepts('html', 'json') === 'html';
  const targetClientId = req.query.clientId;

  if (!isHtmlRequested) {
    if (targetClientId) {
      const session = clients[targetClientId];
      if (!session) {
        return res.status(404).json({ success: false, error: `Session not found for clientId: ${targetClientId}` });
      }
      return res.json({
        success: true,
        clientId: targetClientId,
        state: session.state,
        authenticated: ['AUTHENTICATED', 'READY'].includes(session.state),
        clientInfo: session.clientInfo,
        qrCodeAvailable: !!session.qrBase64,
        qrBase64: session.qrBase64,
        queuedCount: (messageQueue[targetClientId] || []).length
      });
    } else {
      const list = Object.keys(clients).map(id => ({
        clientId: id,
        state: clients[id].state,
        authenticated: ['AUTHENTICATED', 'READY'].includes(clients[id].state),
        clientInfo: clients[id].clientInfo,
        qrCodeAvailable: !!clients[id].qrBase64,
        qrBase64: clients[id].qrBase64,
        queuedCount: (messageQueue[id] || []).length
      }));
      return res.json({ success: true, clients: list, messages: messagesLog });
    }
  }

  // --- Render beautiful developers dashboard console ---
  let dashboardHtml = '';

  if (targetClientId) {
    // Render individual client status/QR view
    const session = clients[targetClientId];
    if (!session) {
      res.status(404).send(`<h3>Session not found for client ID: ${targetClientId}. <a href="/status">Back to Dashboard</a></h3>`);
      return;
    }

    dashboardHtml = `
      <div class="card">
        <div class="header">
          <h1 class="brand-title">
            <svg class="svg-icon" style="width:18px; height:18px; color:var(--green);" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 10.742h.008v.008h-.008v-.008zm.37 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0h.008v.008h-.008v-.008zm.371 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.372m4.125 0h.008v.008h-.008v-.008zm.371 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.371M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
            Session: ${targetClientId}
          </h1>
          <div class="badge badge-${session.state}">
            <span class="status-dot dot-${session.state}"></span>
            ${session.state.replace('_', ' ')}
          </div>
        </div>

        <div class="content-section">
          ${(messageQueue[targetClientId] && messageQueue[targetClientId].length > 0) ? `
            <div style="background-color: var(--amber-bg); border: 1px solid var(--amber); border-radius: 8px; padding: 0.75rem; margin-bottom: 1.25rem; display: flex; align-items: flex-start; gap: 0.5rem; color: var(--amber); font-size: 0.8125rem; line-height: 1.4;">
              <svg class="svg-icon" style="width: 16px; height: 16px; color: var(--amber); flex-shrink: 0; margin-top: 2px;" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <strong>${messageQueue[targetClientId].length} Messages Held</strong><br>
                These messages are held in queue and will be transmitted automatically once you link a device and the state becomes <strong>READY</strong>.
              </div>
            </div>
          ` : ''}

          ${session.state === 'QR_REQUIRED' && session.qrBase64 ? `
            <p class="instruction-text">To start automating, link a device by scanning this QR code in WhatsApp (Settings &rarr; Linked Devices):</p>
            <div class="qr-wrapper">
              <img class="qr-image" src="${session.qrBase64}" alt="QR code">
            </div>
          ` : ''}

          ${['INITIALIZING', 'AUTHENTICATED'].includes(session.state) ? `
            <p class="instruction-text" style="display:flex; align-items:center; gap:0.5rem;">
              <svg class="svg-icon" style="animation: spin 1s linear infinite;" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Establishing connection and loading web session parameters...
            </p>
          ` : ''}

          ${session.state === 'READY' ? `
            <div class="info-grid">
              <div class="info-row">
                <span class="info-label">Active Connection</span>
                <span class="info-value">+${session.clientInfo?.number || ''} (${session.clientInfo?.pushname || 'No Name'})</span>
              </div>
              <div class="info-row">
                <span class="info-label">Engine Port</span>
                <span class="info-value">:${PORT}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Endpoints</span>
                <span class="info-value">POST /send</span>
              </div>
            </div>

            <div class="code-box-title">
              <span>Send Message Payload Reference</span>
            </div>
            <pre class="code-container">curl -X POST http://${req.headers.host}/send \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${API_KEY}" \\
  -d '{
    "clientId": "${targetClientId}",
    "number": "+91XXXXXXXXXX",
    "message": "Hello from custom API!"
  }'</pre>
          ` : ''}

          ${['FAILED', 'DISCONNECTED'].includes(session.state) ? `
            <p class="instruction-text" style="color:var(--red);">
              Connection offline or lost. Re-establishing connection in the background...
            </p>
          ` : ''}
        </div>

        <div style="margin-top: 1.5rem; text-align: center;">
          <a href="/status" style="color: var(--blue); font-size: 0.875rem; text-decoration: none; font-weight: 500;">&larr; Back to Master Dashboard</a>
        </div>
      </div>

      <script>
        const originalState = "${session.state}";
        setInterval(async () => {
          try {
            const res = await fetch('/status?clientId=${targetClientId}', { headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            if (data.state !== originalState) {
              window.location.reload();
            }
          } catch (e) {
            console.error('API polling failure:', e);
          }
        }, 3000);
      </script>
    `;
  } else {
    // Build initial HTML list of clients and logs to prevent empty load
    const clientIds = Object.keys(clients);
    
    let clientCardsHtml = '';
    if (clientIds.length === 0) {
      clientCardsHtml = `
        <div style="text-align: center; color: var(--text-secondary); padding: 2rem 0; border: 1px dashed var(--border); border-radius: 8px; width: 100%;">
          No active client sessions. Enter a Client ID above to register your first WhatsApp session.
        </div>
      `;
    } else {
      clientCardsHtml = `<div class="client-grid">` + clientIds.map(id => {
        const session = clients[id];
        return `
          <div class="client-card">
            <div class="client-card-header">
              <span class="client-card-title">${id}</span>
              <div class="badge badge-${session.state}">
                <span class="status-dot dot-${session.state}"></span>
                ${session.state.replace('_', ' ')}
              </div>
            </div>
            
            <div class="client-card-body">
              ${session.state === 'READY' ? `
                <div style="font-size: 0.8125rem; line-height: 1.4;">
                  <div style="margin-bottom: 0.25rem;"><strong style="color: var(--text-primary)">Name:</strong> ${session.clientInfo?.pushname || 'N/A'}</div>
                  <div><strong style="color: var(--text-primary)">Phone:</strong> +${session.clientInfo?.number || 'N/A'}</div>
                </div>
              ` : ''}
              
              ${(messageQueue[id] && messageQueue[id].length > 0) ? `
                <div style="margin-top: 0.5rem; font-size: 0.8125rem; color: var(--amber); display: flex; align-items: center; gap: 0.25rem;">
                  <svg class="svg-icon" style="color: var(--amber);" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span><strong>${messageQueue[id].length}</strong> messages held in queue</span>
                </div>
              ` : ''}
              
              ${session.state === 'QR_REQUIRED' && session.qrBase64 ? `
                <div style="display: flex; flex-direction: column; align-items: center; margin: 0.5rem 0;">
                  <img src="${session.qrBase64}" style="width: 140px; height: 140px; border-radius: 4px;" alt="QR Code">
                  <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.375rem;">Scan this QR inside WhatsApp</span>
                </div>
              ` : ''}

              ${['INITIALIZING', 'AUTHENTICATED'].includes(session.state) ? `
                <div style="display: flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem; color: var(--text-secondary);">
                  <svg class="svg-icon" style="animation: spin 1s linear infinite;" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Syncing session parameters...
                </div>
              ` : ''}
            </div>

            <div class="client-card-actions">
              <a class="btn-action" href="/status?clientId=${id}">Console</a>
              <button class="btn-action btn-danger" onclick="disconnectClient('${id}')">Purge</button>
            </div>
          </div>
        `;
      }).join('') + `</div>`;
    }

    let logsFeedHtml = '';
    if (messagesLog.length === 0) {
      logsFeedHtml = `
        <div style="text-align: center; color: var(--text-secondary); padding: 2rem 0; border: 1px dashed var(--border); border-radius: 8px;">
          No message logs yet. Both incoming and outgoing messages will appear here in real-time.
        </div>
      `;
    } else {
      logsFeedHtml = `<div class="logs-feed">` + messagesLog.map(log => {
        const dirClass = log.type === 'incoming' ? 'direction-incoming' : 'direction-outgoing';
        return `
          <div class="log-item">
            <div class="log-item-header">
              <span class="log-direction ${dirClass}">${log.type}</span>
              <span class="log-meta">${log.timestamp} • client: <strong style="color: var(--text-primary)">${log.clientId}</strong></span>
            </div>
            <div class="log-meta" style="font-size: 0.75rem; margin-top: 0.125rem; margin-bottom: 0.25rem;">
              <strong>From:</strong> +${log.from} &rarr; <strong>To:</strong> +${log.to}
            </div>
            <div class="log-body">${log.body}</div>
          </div>
        `;
      }).join('') + `</div>`;
    }

    dashboardHtml = `
      <div class="card" style="max-width: 800px; width: 100%;">
        <div class="header">
          <h1 class="brand-title">
            <svg class="svg-icon" style="width:20px; height:20px; color:var(--green);" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 10.742h.008v.008h-.008v-.008zm.37 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0h.008v.008h-.008v-.008zm.371 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.372m4.125 0h.008v.008h-.008v-.008zm.371 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.371M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
            WhatsApp API Gateway
          </h1>
          <span id="activeSessionsCountBadge" class="badge badge-READY" style="font-size: 0.7rem;">
            ${clientIds.length} ACTIVE SESSIONS
          </span>
        </div>

        <!-- Master Tabs Header -->
        <div class="tabs-container" style="display: flex; gap: 1.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.125rem;">
          <button id="tab-btn-sessions" class="tab-btn tab-active" onclick="switchTab('sessions')" style="background: none; border: none; font-family: inherit; font-size: 0.875rem; font-weight: 600; color: var(--green); cursor: pointer; padding: 0.5rem 0.25rem; transition: all 0.2s; outline: none;">WhatsApp Sessions</button>
          <button id="tab-btn-logs" class="tab-btn" onclick="switchTab('logs')" style="background: none; border: none; font-family: inherit; font-size: 0.875rem; font-weight: 600; color: var(--text-secondary); cursor: pointer; padding: 0.5rem 0.25rem; transition: all 0.2s; outline: none;">Message Logs Activity</button>
        </div>

        <!-- Add Client Form Section (Always visible) -->
        <div class="form-container" style="background-color: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; margin-bottom: 2rem;">
          <h3 style="font-size: 0.875rem; margin-bottom: 0.75rem; font-weight: 600;">Provision New Client Session</h3>
          <div style="display: flex; gap: 0.75rem;">
            <input type="text" id="newClientIdInput" placeholder="e.g. client_phone_number" style="flex: 1; background-color: #04060a; border: 1px solid var(--border); color: #fff; padding: 0.625rem 0.875rem; border-radius: 6px; font-size: 0.875rem; outline: none;">
            <button onclick="registerNewClient()" style="background-color: var(--green); color: #000; border: none; font-weight: 600; padding: 0 1.25rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">Add Session</button>
          </div>
          <div id="formErrorMessage" style="color: var(--red); font-size: 0.75rem; margin-top: 0.5rem; display: none;"></div>
        </div>

        <!-- Tab 1: Sessions Panel -->
        <div id="tab-content-sessions" style="display: block;">
          <div class="content-section">
            <h2 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Registered WhatsApp Accounts</h2>
            <div id="clientCardsContainer">${clientCardsHtml}</div>
          </div>
        </div>

        <!-- Tab 2: Activity Logs Panel -->
        <div id="tab-content-logs" style="display: none;">
          <div class="content-section">
            <h2 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Live Activity Feed</h2>
            <div id="logsFeedContainer">${logsFeedHtml}</div>
          </div>
        </div>
      </div>

      <script>
        let activeTab = 'sessions';
        
        function switchTab(tabName) {
          activeTab = tabName;
          const sessionsBtn = document.getElementById('tab-btn-sessions');
          const logsBtn = document.getElementById('tab-btn-logs');
          const sessionsContent = document.getElementById('tab-content-sessions');
          const logsContent = document.getElementById('tab-content-logs');
          
          if (tabName === 'sessions') {
            sessionsBtn.classList.add('tab-active');
            logsBtn.classList.remove('tab-active');
            sessionsContent.style.display = 'block';
            logsContent.style.display = 'none';
          } else {
            sessionsBtn.classList.remove('tab-active');
            logsBtn.classList.add('tab-active');
            sessionsContent.style.display = 'none';
            logsContent.style.display = 'block';
          }
        }

        async function registerNewClient() {
          const idInput = document.getElementById('newClientIdInput');
          const errorDiv = document.getElementById('formErrorMessage');
          const val = idInput.value.trim();
          
          if (!val) {
            errorDiv.innerText = "Please enter a valid Client ID.";
            errorDiv.style.display = "block";
            return;
          }
          
          errorDiv.style.display = "none";
          try {
            const res = await fetch('/register', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': '${API_KEY}'
              },
              body: JSON.stringify({ clientId: val })
            });
            const data = await res.json();
            if (data.success) {
              idInput.value = '';
              // Refresh client grid dynamically
              pollUpdates();
            } else {
              errorDiv.innerText = data.error || "Failed to register.";
              errorDiv.style.display = "block";
            }
          } catch(e) {
            errorDiv.innerText = "Network error. Make sure server is reachable.";
            errorDiv.style.display = "block";
          }
        }

        async function disconnectClient(id) {
          if (!confirm(\`Are you sure you want to completely disconnect and purge the session data for \${id}?\`)) {
            return;
          }
          try {
            const res = await fetch('/disconnect', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': '${API_KEY}'
              },
              body: JSON.stringify({ clientId: id })
            });
            const data = await res.json();
            if (data.success) {
              // Refresh client grid dynamically
              pollUpdates();
            } else {
              alert(data.error || "Failed to disconnect.");
            }
          } catch(e) {
            alert("Error communicating with gateway server.");
          }
        }

        function escapeHtml(str) {
          return str ? str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '';
        }

        function renderClientGrid(clients) {
          const container = document.getElementById('clientCardsContainer');
          if (clients.length === 0) {
            container.innerHTML = \`
              <div style="text-align: center; color: var(--text-secondary); padding: 2rem 0; border: 1px dashed var(--border); border-radius: 8px; width: 100%;">
                No active client sessions. Enter a Client ID above to register your first WhatsApp session.
              </div>
            \`;
            return;
          }

          let html = '<div class="client-grid">';
          clients.forEach(session => {
            html += \`
              <div class="client-card">
                <div class="client-card-header">
                  <span class="client-card-title">\${escapeHtml(session.clientId)}</span>
                  <div class="badge badge-\${session.state}">
                    <span class="status-dot dot-\${session.state}"></span>
                    \${escapeHtml(session.state.replace('_', ' '))}
                  </div>
                </div>
                
                <div class="client-card-body">
                  \${session.state === 'READY' && session.clientInfo ? \`
                    <div style="font-size: 0.8125rem; line-height: 1.4;">
                      <div style="margin-bottom: 0.25rem;"><strong style="color: var(--text-primary)">Name:</strong> \${escapeHtml(session.clientInfo.pushname || 'N/A')}</div>
                      <div><strong style="color: var(--text-primary)">Phone:</strong> +\${escapeHtml(session.clientInfo.number || 'N/A')}</div>
                    </div>
                  \` : ''}
                  
                  \${session.queuedCount > 0 ? \`
                    <div style="margin-top: 0.5rem; font-size: 0.8125rem; color: var(--amber); display: flex; align-items: center; gap: 0.25rem;">
                      <svg class="svg-icon" style="color: var(--amber);" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span><strong>\${session.queuedCount}</strong> messages held in queue</span>
                    </div>
                  \` : ''}
                  
                  \${session.state === 'QR_REQUIRED' && session.qrBase64 ? \`
                    <div style="display: flex; flex-direction: column; align-items: center; margin: 0.5rem 0;">
                      <img src="\${session.qrBase64}" style="width: 140px; height: 140px; border-radius: 4px;" alt="QR Code">
                      <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.375rem;">Scan this QR inside WhatsApp</span>
                    </div>
                  \` : ''}

                  \${['INITIALIZING', 'AUTHENTICATED'].includes(session.state) ? \`
                    <div style="display: flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem; color: var(--text-secondary);">
                      <svg class="svg-icon" style="animation: spin 1s linear infinite;" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      Syncing session parameters...
                    </div>
                  \` : ''}
                </div>

                <div class="client-card-actions">
                  <a class="btn-action" href="/status?clientId=\${session.clientId}">Console</a>
                  <button class="btn-action btn-danger" onclick="disconnectClient('\${session.clientId}')">Purge</button>
                </div>
              </div>
            \`;
          });
          html += '</div>';
          container.innerHTML = html;
        }

        function renderLogsFeed(messages) {
          const container = document.getElementById('logsFeedContainer');
          if (!messages || messages.length === 0) {
            container.innerHTML = \`
              <div style="text-align: center; color: var(--text-secondary); padding: 2rem 0; border: 1px dashed var(--border); border-radius: 8px;">
                No message logs yet. Both incoming and outgoing messages will appear here in real-time.
              </div>
            \`;
            return;
          }

          let html = '<div class="logs-feed">';
          messages.forEach(log => {
            const dirClass = log.type === 'incoming' ? 'direction-incoming' : 'direction-outgoing';
            html += \`
              <div class="log-item">
                <div class="log-item-header">
                  <span class="log-direction \${dirClass}">\${escapeHtml(log.type)}</span>
                  <span class="log-meta">\${escapeHtml(log.timestamp)} • client: <strong style="color: var(--text-primary)">\${escapeHtml(log.clientId)}</strong></span>
                </div>
                <div class="log-meta" style="font-size: 0.75rem; margin-top: 0.125rem; margin-bottom: 0.25rem;">
                  <strong>From:</strong> +\${escapeHtml(log.from)} &rarr; <strong>To:</strong> +\${escapeHtml(log.to)}
                </div>
                <div class="log-body">\${escapeHtml(log.body)}</div>
              </div>
            \`;
          });
          html += '</div>';
          container.innerHTML = html;
        }

        async function pollUpdates() {
          try {
            const res = await fetch('/status', { headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            
            // Update counts in header badge
            const countBadge = document.getElementById('activeSessionsCountBadge');
            if (countBadge) {
              countBadge.innerText = \`\${data.clients.length} ACTIVE SESSIONS\`;
            }

            // Render updated grid and logs in-place without page flashes
            renderClientGrid(data.clients);
            renderLogsFeed(data.messages);
          } catch(e) {
            console.error("Fail to poll updates:", e);
          }
        }

        // Poll every 3 seconds for active, modern updates
        setInterval(pollUpdates, 3000);
      </script>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp API Console</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #090d16;
          --panel: #111827;
          --border: #1f2937;
          --text-primary: #f9fafb;
          --text-secondary: #9ca3af;
          --green: #10b981;
          --green-bg: rgba(16, 185, 129, 0.1);
          --amber: #f59e0b;
          --amber-bg: rgba(245, 158, 11, 0.1);
          --red: #ef4444;
          --red-bg: rgba(239, 68, 68, 0.1);
          --blue: #3b82f6;
          --blue-bg: rgba(59, 130, 246, 0.1);
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: var(--bg);
          color: var(--text-primary);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1.5rem;
        }

        .card {
          width: 100%;
          max-width: 520px;
          background-color: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 2.25rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
          padding-bottom: 1.25rem;
          margin-bottom: 1.5rem;
        }

        .brand-title {
          font-size: 1.125rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .dot-INITIALIZING { background-color: var(--blue); }
        .dot-QR_REQUIRED { background-color: var(--amber); }
        .dot-AUTHENTICATED { background-color: var(--blue); }
        .dot-READY { background-color: var(--green); }
        .dot-FAILED, .dot-DISCONNECTED { background-color: var(--red); }

        .badge {
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.25rem 0.75rem;
          border-radius: 6px;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
        }

        .badge-INITIALIZING { background-color: var(--blue-bg); color: var(--blue); }
        .badge-QR_REQUIRED { background-color: var(--amber-bg); color: var(--amber); }
        .badge-AUTHENTICATED { background-color: var(--blue-bg); color: var(--blue); }
        .badge-READY { background-color: var(--green-bg); color: var(--green); }
        .badge-FAILED, .badge-DISCONNECTED { background-color: var(--red-bg); color: var(--red); }

        .content-section {
          margin-bottom: 1.5rem;
        }

        .instruction-text {
          font-size: 0.875rem;
          line-height: 1.5;
          color: var(--text-secondary);
          margin-bottom: 1.25rem;
        }

        .qr-wrapper {
          background-color: #ffffff;
          padding: 1.25rem;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          align-items: center;
          margin: 1rem auto 1.5rem;
          width: fit-content;
          border: 1px solid var(--border);
        }

        .qr-image {
          display: block;
          width: 240px;
          height: 240px;
        }

        .info-grid {
          background-color: rgba(255, 255, 255, 0.015);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1.5rem;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          font-size: 0.875rem;
        }

        .info-row:not(:last-child) {
          border-bottom: 1px solid var(--border);
        }

        .info-label {
          color: var(--text-secondary);
        }

        .info-value {
          font-weight: 500;
        }

        .code-box-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .code-container {
          background-color: #04060a;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 1rem;
          font-family: 'Fira Code', monospace;
          font-size: 0.75rem;
          line-height: 1.5;
          color: #a7f3d0; /* emerald-200 */
          overflow-x: auto;
          text-align: left;
          white-space: pre;
        }

        .footer-note {
          font-size: 0.75rem;
          color: var(--text-secondary);
          text-align: center;
          margin-top: 1.5rem;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.375rem;
        }

        .svg-icon {
          width: 14px;
          height: 14px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2;
        }

        /* Master Dashboard Client Grid Styles */
        .client-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }

        .client-card {
          background-color: rgba(255, 255, 255, 0.015);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 170px;
        }

        .client-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.75rem;
          gap: 0.5rem;
        }

        .client-card-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .client-card-body {
          flex: 1;
          margin-bottom: 0.75rem;
        }

        .client-card-actions {
          display: flex;
          gap: 0.5rem;
          border-top: 1px solid var(--border);
          padding-top: 0.75rem;
        }

        .btn-action {
          flex: 1;
          text-align: center;
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          font-weight: 500;
          text-decoration: none;
          background-color: var(--border);
          color: var(--text-primary);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .btn-action:hover {
          background-color: #374151;
        }

        .btn-danger {
          background-color: var(--red-bg);
          color: var(--red);
        }

        .btn-danger:hover {
          background-color: rgba(239, 68, 68, 0.2);
        }

        /* Tabs Styles */
        .tab-btn {
          border-bottom: 2px solid transparent !important;
          padding-bottom: 0.5rem !important;
        }
        
        .tab-active {
          color: var(--green) !important;
          border-bottom: 2px solid var(--green) !important;
        }
        
        /* Logs Activity Feed Styles */
        .logs-feed {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          max-height: 400px;
          overflow-y: auto;
          padding-right: 0.5rem;
        }
        
        .log-item {
          background-color: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.75rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.8125rem;
          text-align: left;
        }
        
        .log-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
        }
        
        .log-direction {
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-size: 0.6875rem;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
        }
        
        .direction-incoming {
          background-color: var(--blue-bg);
          color: var(--blue);
        }
        
        .direction-outgoing {
          background-color: var(--green-bg);
          color: var(--green);
        }
        
        .log-meta {
          color: var(--text-secondary);
        }
        
        .log-body {
          color: var(--text-primary);
          line-height: 1.4;
          word-break: break-all;
          white-space: pre-wrap;
          font-family: inherit;
          background-color: rgba(0, 0, 0, 0.15);
          padding: 0.5rem;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.01);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      ${dashboardHtml}
    </body>
    </html>
  `;

  res.send(html);
});

// REST API endpoint to send a message
app.post('/send', authenticate, async (req, res) => {
  const { clientId, number, message, mediaUrl, mediaBase64, mimetype, filename, latitude, longitude, name, address } = req.body;

  // 1. Basic validation (requires number and at least one payload type)
  const hasLocation = latitude !== undefined && longitude !== undefined;
  if (!number || (!message && !mediaUrl && !mediaBase64 && !hasLocation)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Bad Request: "number" and at least one of "message", "mediaUrl", "mediaBase64", or both "latitude" and "longitude" are required.' 
    });
  }

  // 2. Resolve client ID session
  let targetClientId = clientId;
  if (!targetClientId) {
    const activeIds = Object.keys(clients);
    if (activeIds.length === 1) {
      targetClientId = activeIds[0];
    } else {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: "clientId" is required to route messages among multiple connected accounts.'
      });
    }
  }

  // Trim and sanitize targetClientId to prevent space and character issues (e.g. " 7033769997" -> "7033769997")
  targetClientId = targetClientId.trim().replace(/[^a-zA-Z0-9_\-+@.]/g, '');

  // Ensure the resolved client ID is exactly a 10-digit phone number
  if (!/^\d{10}$/.test(targetClientId)) {
    return res.status(400).json({
      success: false,
      error: 'Bad Request: "clientId" must be exactly a 10-digit phone number.'
    });
  }

  let session = clients[targetClientId];
  if (!session) {
    console.log(`[WhatsApp API] [${targetClientId}] Session not active in memory. Auto-provisioning...`);
    try {
      session = await getOrInitializeClient(targetClientId);
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: `Failed to auto-initialize session for client ID: ${targetClientId}`,
        details: err.message
      });
    }
  }

  // 3. Ensure connection state is READY for that client (otherwise hold in queue)
  if (session.state !== 'READY') {
    if (!messageQueue[targetClientId]) {
      messageQueue[targetClientId] = [];
    }
    messageQueue[targetClientId].push({
      number, message, mediaUrl, mediaBase64, mimetype, filename, latitude, longitude, name, address
    });

    console.log(`[WhatsApp API] [${targetClientId}] Message held in queue (state: ${session.state}). Held count: ${messageQueue[targetClientId].length}`);

    let userFriendlyMsg = `We don't have any active session for client "${targetClientId}". Please scan the QR code to continue.`;
    if (session.state === 'INITIALIZING') {
      userFriendlyMsg = `We don't have any active session for client "${targetClientId}". Initializing session in background... Please scan the QR code once it appears to continue.`;
    }

    return res.status(200).json({
      success: true,
      status: 'HOLD',
      message: userFriendlyMsg,
      clientId: targetClientId,
      state: session.state,
      qrCodeAvailable: !!session.qrBase64,
      qrBase64: session.qrBase64
    });
  }

  try {
    // 4. Clean and parse number
    let cleaned = number.replace(/\D/g, '');
    let chatId;
    const client = session.client;
    if (number.endsWith('@c.us') || number.endsWith('@g.us')) {
      chatId = number;
    } else {
      try {
        const numberId = await client.getNumberId(cleaned);
        if (numberId) {
          chatId = numberId._serialized;
        } else {
          chatId = `${cleaned}@c.us`;
        }
      } catch (e) {
        chatId = `${cleaned}@c.us`;
      }
    }

    let response;

    // 5. Send Location Card if provided
    if (hasLocation) {
      const latNum = parseFloat(latitude);
      const lngNum = parseFloat(longitude);
      
      if (isNaN(latNum) || isNaN(lngNum)) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request: "latitude" and "longitude" must be valid numbers.'
        });
      }
      
      console.log(`[WhatsApp API] [${targetClientId}] Sending location card to ${chatId}: Lat ${latNum}, Lng ${lngNum} (${name || 'No Name'})`);
      const locationObj = new Location(latNum, lngNum, {
        name: name || '',
        address: address || ''
      });
      response = await client.sendMessage(chatId, locationObj);
    } 
    // 6. Send Media Attachment if provided
    else if (mediaUrl) {
      console.log(`[WhatsApp API] [${targetClientId}] Downloading attachment from URL: ${mediaUrl}`);
      const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
      console.log(`[WhatsApp API] [${targetClientId}] Sending media to ${chatId} with caption: "${message || ''}"`);
      response = await client.sendMessage(chatId, media, message ? { caption: message } : {});
    } else if (mediaBase64) {
      if (!mimetype) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request: "mimetype" is required when sending base64 media attachment.'
        });
      }
      console.log(`[WhatsApp API] [${targetClientId}] Parsing Base64 media attachment (${mimetype})`);
      const media = new MessageMedia(mimetype, mediaBase64, filename || 'attachment');
      console.log(`[WhatsApp API] [${targetClientId}] Sending media to ${chatId} with caption: "${message || ''}"`);
      response = await client.sendMessage(chatId, media, message ? { caption: message } : {});
    } 
    // 7. Send Plain Text Message
    else {
      console.log(`[WhatsApp API] [${targetClientId}] Sending text message to ${chatId}: "${message}"`);
      response = await client.sendMessage(chatId, message);
    }

    // Log outgoing message in-memory
    messagesLog.unshift({
      id: response.id._serialized,
      timestamp: new Date().toLocaleTimeString(),
      clientId: targetClientId,
      type: 'outgoing',
      from: session.clientInfo ? session.clientInfo.number : 'Self',
      to: chatId.replace('@c.us', '').replace('@g.us', ''),
      body: message || (mediaUrl ? `[Media URL: ${mediaUrl}]` : mediaBase64 ? '[Base64 Media]' : '[Location Card]'),
      status: 'SENT'
    });

    if (messagesLog.length > 200) {
      messagesLog.pop();
    }

    return res.status(200).json({
      success: true,
      data: {
        messageId: response.id._serialized,
        timestamp: response.timestamp,
        chatId: response.to
      }
    });
  } catch (error) {
    console.error(`[WhatsApp API] [${targetClientId}] Error sending message:`, error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to send message', 
      details: error.message 
    });
  }
});

// Port listener & Session auto-loader
app.listen(PORT, async () => {
  console.log(`[Server] WhatsApp Lite API Server running on http://localhost:${PORT}`);
  console.log(`[Server] Multi-Session Status dashboard available at http://localhost:${PORT}/status`);
  console.log(`[Server] API Authentication Key is: ${API_KEY}`);

  // Sequential session auto-loader
  const authDir = path.resolve(__dirname, '.wwebjs_auth');
  if (fs.existsSync(authDir)) {
    try {
      const files = fs.readdirSync(authDir);
      const sessionDirs = [];
      
      for (const f of files) {
        if (f.startsWith('session-')) {
          const fullPath = path.join(authDir, f);
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              const clientId = f.substring('session-'.length);
              if (/^\d{10}$/.test(clientId)) {
                sessionDirs.push(f);
              } else {
                // Self-heal: Clean up non-10 digit corrupted session folders
                console.log(`[Server] Self-Healing: Removing invalid/corrupted session folder from disk: ${f}`);
                fs.rmSync(fullPath, { recursive: true, force: true });
              }
            }
          } catch (err) {
            console.error(`[Server] Error processing session folder ${f}:`, err.message);
          }
        }
      }
      
      if (sessionDirs.length > 0) {
        console.log(`[Server] Found ${sessionDirs.length} existing sessions to auto-load. Booting sequentially...`);
        
        for (let i = 0; i < sessionDirs.length; i++) {
          const dirName = sessionDirs[i];
          const clientId = dirName.substring('session-'.length);
          
          // Wait 5s staggered delay before each startup to prevent CPU spikes
          if (i > 0) {
            console.log(`[Server] Staggering load... Waiting 5s before starting next session: ${clientId}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          
          console.log(`[Server] Auto-loading session: ${clientId}`);
          getOrInitializeClient(clientId).catch(err => {
            console.error(`[Server] Failed to auto-load session for client: ${clientId}:`, err);
          });
        }
      }
    } catch (err) {
      console.error('[Server] Error scanning auto-load session directories:', err);
    }
  }
});

// Clean shutdown handler to prevent lingering Chromium processes
const cleanShutdown = async () => {
  console.log('\n[Server] Received shutdown signal. Cleaning up active resources...');
  const activeIds = Object.keys(clients);
  
  for (const id of activeIds) {
    try {
      const session = clients[id];
      if (session && session.client) {
        console.log(`[Server] Closing Puppeteer client for: ${id}`);
        await session.client.destroy();
      }
    } catch (err) {
      console.error(`[Server] Error closing client: ${id}:`, err);
    }
  }
  
  console.log('[Server] Goodbye!');
  process.exit(0);
};

process.on('SIGINT', cleanShutdown);
process.on('SIGTERM', cleanShutdown);
