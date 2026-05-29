# WhatsApp Lite API Gateway 🚀

An ultra-lightweight, extremely fast, single-session WhatsApp automation REST API built with Node.js, Express, and `whatsapp-web.js`.

This API exposes a simple POST endpoint to send messages and features an elegant browser-based dashboard to scan the QR code and monitor connection status. It utilizes optimal, resource-efficient Puppeteer configurations derived from standard production architectures.

---

## Features
- **Fast & Small:** Minimal memory footprint (uses container Chromium or local Chrome, skipping massive Chromium downloads).
- **Persistent Session:** Uses `LocalAuth` to store and persist session details so you only scan the QR code once.
- **Dynamic Dual QR Code:** Prints the QR code directly to your terminal console, AND exposes a sleek dark-themed browser dashboard `/status` that displays the live QR code and reloads dynamically upon state changes.
- **Robust Phone Formatter:** Cleanses inputs automatically. Accepts `+xxx xxxxxxxxxx`, local numbers, or spaces and reformats them perfectly for WhatsApp delivery.
- **Dockerized:** Out-of-the-box support for containerization, pre-packaged with all dependencies required for running headless Chrome in Linux.

---

## Installation & Setup

### 1. Running Locally
Make sure you have Node.js (v18+) installed.

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure optional environment variables:**
   Create a `.env` file in the root:
   ```env
   PORT=3000
   API_KEY=your_optional_secret_api_key
   ```
3. **Start the API server:**
   ```bash
   npm start
   ```
4. **Link WhatsApp:**
   - Watch your terminal console logs; a scan-ready QR code will be printed.
   - Or, open `http://localhost:3000/status` in your browser to view a beautiful, dynamically refreshed dark-mode QR code, and scan it with your phone (WhatsApp -> Linked Devices).

---

### 2. Running with Docker Compose 🐳

We provide a pre-configured `docker-compose.yml` to orchestrate building and volume-persisting your API with a single command:

1. **Start the API Server (Builds and runs in background):**
   ```bash
   docker compose up -d
   ```
2. **Access the Console:**
   Open `http://localhost:3000/status` in your browser to view your self-healing developer console and scan the QR code.
3. **Stop the Container:**
   ```bash
   docker compose down
   ```

---

## API Endpoints

### 1. Get Gateway Status
Checks current connection state and exposes QR code if login is required.
- **URL:** `/status`
- **Method:** `GET`
- **Headers:** `Accept: application/json` (or visit in browser for HTML visual interface)
- **Sample JSON Response:**
  ```json
  {
    "success": true,
    "state": "READY",
    "authenticated": true,
    "clientInfo": {
      "number": "1234567890",
      "pushname": "John Doe"
    },
    "qrCodeAvailable": false
  }
  ```

### 2. Send Message (Text, Files, & Location Maps)
Sends a plain text message, a file attachment from a URL, a file attachment from a Base64-encoded string, or a native interactive location map card. If a `message` is passed alongside media, it will be delivered as the caption of that media.

- **URL:** `/send`
- **Method:** `POST`
- **Headers:** 
  - `Content-Type: application/json`
  - `X-API-Key: Narzo50pro@gmail.com` (Static API Key pre-set by default in `index.js`)

#### Request Payloads

##### Option A: Standard Text Message
```json
{
  "number": "+1 234 567 8900",
  "message": "Hello from my custom WhatsApp API! 🚀"
}
```

##### Option B: Send File from a URL (e.g. Image, PDF, Document)
```json
{
  "number": "+1 234 567 8900",
  "mediaUrl": "https://www.open-wa.org/assets/openwa_logo.webp",
  "message": "Check out this logo! 🖼️" 
}
```

##### Option C: Send File via Base64 Payload
```json
{
  "number": "+1 234 567 8900",
  "mediaBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "mimetype": "image/png",
  "filename": "pixel.png",
  "message": "Here is a tiny transparent pixel image!"
}
```

##### Option D: Send Location Map Card
```json
{
  "number": "+1 234 567 8900",
  "latitude": 27.1751,
  "longitude": 78.0421,
  "name": "Taj Mahal",
  "address": "Dharmapuri, Forest Colony, Tajganj, Agra, Uttar Pradesh 282001"
}
```

- **Sample Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "messageId": "true_1234567890@c.us_3EB0C6F5A8274E82A1B9",
      "timestamp": 1699923845,
      "chatId": "1234567890@c.us"
    }
  }
  ```

---

## Key Technical Implementations
- **Local Cache Persistence:** All session assets are cached under `.wwebjs_auth/`. Backing up or persisting this folder ensures your credentials are saved.
- **Resilient Chrome Launch Flags:** Uses `--no-sandbox`, `--disable-setuid-sandbox`, and `--disable-dev-shm-usage` flags inside the container, resolving system level locks or Chrome sandbox crashes automatically.
- **Signal Handling:** Docker executes the server using `dumb-init` as `PID 1`, allowing seamless propagation of SIGTERM/SIGINT signals so child Chromium processes terminate properly.
