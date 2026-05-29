const express = require('express');
const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'Narzo50pro@gmail.com';

// Track connection state & auto-recovery timer
let connectionState = 'INITIALIZING'; // INITIALIZING, QR_REQUIRED, AUTHENTICATED, READY, FAILED, DISCONNECTED
let currentQrData = null;
let currentQrBase64 = null;
let clientInfo = null;
let readyTimeout = null;

// Initialize WhatsApp client with robust Puppeteer flags (derived from OpenWA's production config)
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'whatsapp-lite-session',
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

// Setup event listeners
client.on('qr', async (qr) => {
  connectionState = 'QR_REQUIRED';
  currentQrData = qr;
  
  // 1. Generate QR in Terminal
  console.log('\n--- SCAN THE QR CODE BELOW TO CONNECT WHATSAPP ---');
  qrcodeTerminal.generate(qr, { small: true });
  console.log('---------------------------------------------------\n');

  // 2. Generate Base64 QR Image for API/Web UI
  try {
    currentQrBase64 = await QRCode.toDataURL(qr, {
      margin: 2,
      width: 300,
      color: {
        dark: '#1e293b', // slate-800
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Failed to generate Base64 QR Code:', err);
  }
});

client.on('authenticated', () => {
  connectionState = 'AUTHENTICATED';
  currentQrData = null;
  currentQrBase64 = null;
  console.log('[WhatsApp API] Authentication successful! Syncing session...');

  // Setup auto-recovery watchdog: if we don't reach READY within 25 seconds,
  // trigger a background reload of the page to kickstart the sync.
  if (readyTimeout) clearTimeout(readyTimeout);
  readyTimeout = setTimeout(async () => {
    if (connectionState === 'AUTHENTICATED') {
      console.log('[WhatsApp API] Initialization sync is taking longer than expected. Performing an automatic background refresh...');
      try {
        if (client.pupPage) {
          await client.pupPage.reload();
          console.log('[WhatsApp API] Page refreshed successfully. Resuming sync...');
        }
      } catch (err) {
        console.error('[WhatsApp API] Automatic background refresh failed:', err.message);
      }
    }
  }, 15000); // 15 seconds
});

client.on('auth_failure', (msg) => {
  connectionState = 'FAILED';
  if (readyTimeout) clearTimeout(readyTimeout);
  console.error('[WhatsApp API] Authentication failed:', msg);
});

client.on('ready', () => {
  connectionState = 'READY';
  if (readyTimeout) clearTimeout(readyTimeout);
  clientInfo = {
    number: client.info.wid.user,
    pushname: client.info.pushname
  };
  console.log(`[WhatsApp API] Client is fully READY and authenticated as +${clientInfo.number} (${clientInfo.pushname})!`);
});

client.on('disconnected', (reason) => {
  connectionState = 'DISCONNECTED';
  if (readyTimeout) clearTimeout(readyTimeout);
  clientInfo = null;
  currentQrData = null;
  currentQrBase64 = null;
  console.log('[WhatsApp API] Client was disconnected:', reason);
  
  // Re-initialize client
  console.log('[WhatsApp API] Re-initializing connection...');
  client.initialize();
});

// Start the client connection
console.log('[WhatsApp API] Starting WhatsApp Client...');
client.initialize().catch(err => {
  console.error('[WhatsApp API] Failed to initialize client:', err);
  connectionState = 'FAILED';
});

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

// Expose /status with premium Stripe/Vercel-style Dev Console
app.get('/status', (req, res) => {
  const isHtmlRequested = req.accepts('html', 'json') === 'html';
  
  const statusPayload = {
    success: true,
    state: connectionState,
    authenticated: ['AUTHENTICATED', 'READY'].includes(connectionState),
    clientInfo,
    qrCodeAvailable: !!currentQrBase64
  };

  if (!isHtmlRequested) {
    return res.json(statusPayload);
  }

  // Generate a beautiful, clean, hand-crafted developer console (no AI clichés)
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
          padding: 1.5rem;
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
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1 class="brand-title">
            <svg class="svg-icon" style="width:18px; height:18px; color:var(--green);" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 10.742h.008v.008h-.008v-.008zm.37 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0h.008v.008h-.008v-.008zm.371 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.372m4.125 0h.008v.008h-.008v-.008zm.371 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.371M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
            WhatsApp API Console
          </h1>
          <div class="badge badge-${connectionState}">
            <span class="status-dot dot-${connectionState}"></span>
            ${connectionState.replace('_', ' ')}
          </div>
        </div>

        <div class="content-section">
          ${connectionState === 'QR_REQUIRED' && currentQrBase64 ? `
            <p class="instruction-text">To start automating, link a device by scanning this QR code in WhatsApp (Settings &rarr; Linked Devices):</p>
            <div class="qr-wrapper">
              <img class="qr-image" src="${currentQrBase64}" alt="QR code">
            </div>
          ` : ''}

          ${['INITIALIZING', 'AUTHENTICATED'].includes(connectionState) ? `
            <p class="instruction-text" style="display:flex; align-items:center; gap:0.5rem;">
              <svg class="svg-icon" style="animation: spin 1s linear infinite;" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Establishing connection and loading web session parameters...
            </p>
          ` : ''}

          ${connectionState === 'READY' ? `
            <div class="info-grid">
              <div class="info-row">
                <span class="info-label">Active Connection</span>
                <span class="info-value">+${clientInfo?.number || ''} (${clientInfo?.pushname || 'No Name'})</span>
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
    "number": "+917004430152",
    "message": "Hello from custom API!"
  }'</pre>
          ` : ''}

          ${['FAILED', 'DISCONNECTED'].includes(connectionState) ? `
            <p class="instruction-text" style="color:var(--red);">
              Connection offline or lost. Re-establishing connection in the background...
            </p>
          ` : ''}
        </div>

        <div class="footer-note">
          <svg class="svg-icon" style="color:var(--text-secondary);" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Standalone API Gateway • Active Node v${process.versions.node}
        </div>
      </div>

      <style>
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>

      <script>
        const originalState = "${connectionState}";
        setInterval(async () => {
          try {
            const res = await fetch('/status', { headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            if (data.state !== originalState) {
              window.location.reload();
            }
          } catch (e) {
            console.error('API polling failure:', e);
          }
        }, 3000);
      </script>
    </body>
    </html>
  `;

  res.send(html);
});

// REST API endpoint to send a message
app.post('/send', authenticate, async (req, res) => {
  const { number, message, mediaUrl, mediaBase64, mimetype, filename, latitude, longitude, name, address } = req.body;

  // 1. Basic validation (requires number and at least one payload type: message, mediaUrl, mediaBase64, or location coordinates)
  const hasLocation = latitude !== undefined && longitude !== undefined;
  if (!number || (!message && !mediaUrl && !mediaBase64 && !hasLocation)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Bad Request: "number" and at least one of "message", "mediaUrl", "mediaBase64", or both "latitude" and "longitude" are required.' 
    });
  }

  // 2. Ensure connection state is READY
  if (connectionState !== 'READY') {
    return res.status(503).json({ 
      success: false, 
      error: `Service Unavailable: WhatsApp Gateway is in state: ${connectionState}. Visit /status in a browser to check/scan QR code.` 
    });
  }

  try {
    // 3. Clean and parse number
    // Clean string by keeping only digits
    let cleaned = number.replace(/\D/g, '');
    
    // Add WhatsApp suffix domain if not already present
    // Format is either [country_code][number]@c.us or group-id@g.us
    let chatId;
    if (number.endsWith('@c.us') || number.endsWith('@g.us')) {
      chatId = number;
    } else {
      chatId = `${cleaned}@c.us`;
    }

    let response;

    // 4. Resolve and Send Location Card if provided
    if (hasLocation) {
      const latNum = parseFloat(latitude);
      const lngNum = parseFloat(longitude);
      
      if (isNaN(latNum) || isNaN(lngNum)) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request: "latitude" and "longitude" must be valid numbers.'
        });
      }
      
      console.log(`[WhatsApp API] Sending location card to ${chatId}: Lat ${latNum}, Lng ${lngNum} (${name || 'No Name'})`);
      const locationObj = new Location(latNum, lngNum, {
        name: name || '',
        address: address || ''
      });
      response = await client.sendMessage(chatId, locationObj);
    } 
    // 5. Resolve and Send Media Attachment if provided
    else if (mediaUrl) {
      console.log(`[WhatsApp API] Downloading attachment from URL: ${mediaUrl}`);
      const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
      console.log(`[WhatsApp API] Sending media to ${chatId} with caption: "${message || ''}"`);
      response = await client.sendMessage(chatId, media, message ? { caption: message } : {});
    } else if (mediaBase64) {
      if (!mimetype) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request: "mimetype" is required when sending base64 media attachment.'
        });
      }
      console.log(`[WhatsApp API] Parsing Base64 media attachment (${mimetype})`);
      const media = new MessageMedia(mimetype, mediaBase64, filename || 'attachment');
      console.log(`[WhatsApp API] Sending media to ${chatId} with caption: "${message || ''}"`);
      response = await client.sendMessage(chatId, media, message ? { caption: message } : {});
    } 
    // 6. Send Plain Text Message
    else {
      console.log(`[WhatsApp API] Sending text message to ${chatId}: "${message}"`);
      response = await client.sendMessage(chatId, message);
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
    console.error('[WhatsApp API] Error sending message:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to send message', 
      details: error.message 
    });
  }
});

// Port listener
app.listen(PORT, () => {
  console.log(`[Server] WhatsApp Lite API Server running on http://localhost:${PORT}`);
  console.log(`[Server] Status & QR scanner dashboard available at http://localhost:${PORT}/status`);
  console.log(`[Server] API Authentication Key is: ${API_KEY}`);
});

// Clean shutdown handler to prevent lingering Chromium processes and locked sessions
const cleanShutdown = async () => {
  console.log('\n[Server] Received shutdown signal. Cleaning up resources...');
  try {
    if (client) {
      await client.destroy();
      console.log('[Server] Headless browser closed cleanly. Folder locks released.');
    }
  } catch (err) {
    console.error('[Server] Error during client destruction:', err);
  }
  console.log('[Server] Goodbye!');
  process.exit(0);
};

process.on('SIGINT', cleanShutdown);
process.on('SIGTERM', cleanShutdown);
