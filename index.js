const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || null;

// Track connection state
let connectionState = 'INITIALIZING'; // INITIALIZING, QR_REQUIRED, AUTHENTICATED, READY, FAILED, DISCONNECTED
let currentQrData = null;
let currentQrBase64 = null;
let clientInfo = null;

// Initialize WhatsApp client with robust Puppeteer flags (derived from OpenWA's production config)
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'whatsapp-lite-session',
    dataPath: path.resolve(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
  console.log('[WhatsApp API] Authentication successful! Loading session...');
});

client.on('auth_failure', (msg) => {
  connectionState = 'FAILED';
  console.error('[WhatsApp API] Authentication failed:', msg);
});

client.on('ready', () => {
  connectionState = 'READY';
  clientInfo = {
    number: client.info.wid.user,
    pushname: client.info.pushname
  };
  console.log(`[WhatsApp API] Client is fully READY and authenticated as +${clientInfo.number} (${clientInfo.pushname})!`);
});

client.on('disconnected', (reason) => {
  connectionState = 'DISCONNECTED';
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

// Expose /status with premium Glassmorphism Dark Theme
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

  // Generate responsive premium dark HTML layout with modern typography and gradients
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp API Gateway - Status</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
      <style>
        :root {
          --primary: #10b981;
          --primary-glow: rgba(16, 185, 129, 0.15);
          --danger: #ef4444;
          --warning: #f59e0b;
          --dark-bg: #0b0f19;
          --glass-bg: rgba(17, 24, 39, 0.7);
          --glass-border: rgba(255, 255, 255, 0.08);
          --text-primary: #f8fafc;
          --text-secondary: #94a3b8;
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          background-color: var(--dark-bg);
          background-image: 
            radial-gradient(circle at 10% 20%, rgba(16, 185, 129, 0.05) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(99, 102, 241, 0.05) 0%, transparent 40%);
          color: var(--text-primary);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          overflow-x: hidden;
        }

        .container {
          width: 100%;
          max-width: 480px;
          background: var(--glass-bg);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--glass-border);
          border-radius: 24px;
          padding: 2.5rem;
          box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
          text-align: center;
          position: relative;
        }

        .header {
          margin-bottom: 2rem;
        }

        .logo {
          font-size: 1.75rem;
          font-weight: 800;
          background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 0.5rem;
          letter-spacing: -0.025em;
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 1.25rem;
          border-radius: 9999px;
          font-size: 0.875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 2rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          transition: all 0.3s ease;
        }

        /* Statuses */
        .status-INITIALIZING {
          background-color: rgba(59, 130, 246, 0.1);
          color: #3b82f6;
          border: 1px solid rgba(59, 130, 246, 0.2);
        }
        .status-QR_REQUIRED {
          background-color: rgba(245, 158, 11, 0.1);
          color: var(--warning);
          border: 1px solid rgba(245, 158, 11, 0.2);
          animation: pulse 2s infinite;
        }
        .status-AUTHENTICATED {
          background-color: rgba(16, 185, 129, 0.1);
          color: var(--primary);
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .status-READY {
          background-color: rgba(16, 185, 129, 0.15);
          color: var(--primary);
          border: 1px solid rgba(16, 185, 129, 0.3);
          box-shadow: 0 0 15px var(--primary-glow);
        }
        .status-FAILED, .status-DISCONNECTED {
          background-color: rgba(239, 68, 68, 0.1);
          color: var(--danger);
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .qr-container {
          background: #ffffff;
          padding: 1.5rem;
          border-radius: 20px;
          display: inline-block;
          margin: 0.5rem auto 2rem;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          transition: transform 0.3s ease;
        }

        .qr-container:hover {
          transform: scale(1.02);
        }

        .qr-image {
          display: block;
          max-width: 250px;
          height: auto;
        }

        .success-illustration {
          font-size: 5rem;
          margin: 1.5rem 0 2rem;
          animation: scaleUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .success-info {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 1.25rem;
          margin-bottom: 2rem;
          text-align: left;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
          font-size: 0.935rem;
        }

        .info-row:last-child {
          margin-bottom: 0;
        }

        .info-label {
          color: var(--text-secondary);
        }

        .info-value {
          font-weight: 600;
          color: var(--text-primary);
        }

        .instructions {
          font-size: 0.95rem;
          line-height: 1.6;
          color: var(--text-secondary);
          margin-bottom: 1rem;
        }

        .instructions strong {
          color: var(--text-primary);
        }

        .curl-example {
          background: #040711;
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          padding: 1rem;
          text-align: left;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.75rem;
          overflow-x: auto;
          color: #a7f3d0;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .curl-header {
          display: flex;
          justify-content: space-between;
          color: var(--text-secondary);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
          font-weight: 600;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(0.98); }
        }

        @keyframes scaleUp {
          from { transform: scale(0.8); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">WhatsApp API Gateway</div>
          <div class="subtitle">Fast & Lightweight Automation Server</div>
        </div>

        <div class="status-badge status-${connectionState}">
          <span style="display:inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: currentColor;"></span>
          ${connectionState.replace('_', ' ')}
        </div>

        ${connectionState === 'QR_REQUIRED' && currentQrBase64 ? `
          <p class="instructions">Open WhatsApp on your phone, navigate to <strong>Linked Devices</strong>, and scan this QR code:</p>
          <div class="qr-container">
            <img class="qr-image" src="${currentQrBase64}" alt="Scan Me">
          </div>
        ` : ''}

        ${['INITIALIZING', 'AUTHENTICATED'].includes(connectionState) ? `
          <div class="success-illustration">⏳</div>
          <p class="instructions" style="margin-bottom: 2rem;">Connecting and restoring WhatsApp session... Please hold.</p>
        ` : ''}

        ${connectionState === 'READY' ? `
          <div class="success-illustration">⚡</div>
          <div class="success-info">
            <div class="info-row">
              <span class="info-label">Connected Name:</span>
              <span class="info-value">${clientInfo?.pushname || 'Unknown'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Connected Phone:</span>
              <span class="info-value">+${clientInfo?.number || ''}</span>
            </div>
            <div class="info-row">
              <span class="info-label">API Endpoints:</span>
              <span class="info-value">POST /send</span>
            </div>
          </div>
          <p class="instructions" style="text-align:left; margin-bottom: 0.5rem;"><strong>Ready to Automate!</strong> Run the following test command:</p>
          <div class="curl-header">Test HTTP curl request</div>
          <pre class="curl-example">curl -X POST http://${req.headers.host}/send \\
  -H "Content-Type: application/json" \\
  -d '{
    "number": "+1234567890",
    "message": "Hello from API Gateway! 🚀"
  }'</pre>
        ` : ''}

        ${['FAILED', 'DISCONNECTED'].includes(connectionState) ? `
          <div class="success-illustration" style="filter: hue-rotate(120deg);">❌</div>
          <p class="instructions" style="margin-bottom: 2rem;">Connection disconnected or failed. Reconnecting in the background...</p>
        ` : ''}
      </div>

      <script>
        // Self-updating micro script: polls status every 3 seconds
        // Reloads the page if connectionState changes to keep QR and details aligned.
        const originalState = "${connectionState}";
        setInterval(async () => {
          try {
            const res = await fetch('/status', { headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            if (data.state !== originalState) {
              window.location.reload();
            }
          } catch (e) {
            console.error('Failed to poll status:', e);
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
  const { number, message } = req.body;

  // 1. Basic validation
  if (!number || !message) {
    return res.status(400).json({ 
      success: false, 
      error: 'Bad Request: "number" and "message" fields are required.' 
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

    console.log(`[WhatsApp API] Sending message to ${chatId}: "${message}"`);
    
    // 4. Send Message via whatsapp-web.js client
    const response = await client.sendMessage(chatId, message);

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
});
