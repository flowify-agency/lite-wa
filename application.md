# Next.js Integration Guide: WhatsApp Gateway 🚀

This document provides complete, copy-paste-ready documentation and integration snippets to connect your **Next.js** application (such as a checkout, order management, or user notification system) securely to the WhatsApp Multi-Session Gateway.

---

## ⚡ Integration Architecture & Security

Since the WhatsApp Gateway requires a secret `X-API-Key` (`Narzo50pro@gmail.com`), you **must never** call the gateway directly from client-side React components (e.g., standard browser `fetch` calls). Doing so would expose your API key to users.

Always route your requests through Next.js server-side layers:
1. **Next.js Server Actions** (For form actions or inline interactions)
2. **Next.js Route Handlers / API Routes** (For structured webhooks or programmatic checkouts)

---

## 🛠️ Method 1: Next.js API Route (App Router)

Create a dedicated server-side endpoint in your Next.js project at `app/api/whatsapp/route.js` (or `.ts`). This endpoint acts as a secure proxy to forward checkout notification requests to your gateway.

### 1. Create the API Route:
`app/api/whatsapp/route.js`

```javascript
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { phone, message, clientId } = await request.json();

    // Basic Validation
    if (!phone || !message) {
      return NextResponse.json(
        { success: false, error: 'Missing phone or message body' },
        { status: 400 }
      );
    }

    const GATEWAY_URL = 'http://localhost:10000/send';
    
    // Forward payload to the WhatsApp Gateway securely
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.WHATSAPP_API_KEY || 'Narzo50pro@gmail.com'
      },
      body: JSON.stringify({
        clientId: clientId || '7033769997', // Target active client account
        number: phone,
        message: message
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to dispatch via Gateway' },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true, messageId: data.data.messageId });

  } catch (error) {
    console.error('WhatsApp Proxy Route Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
```

### 2. Call from Client Components:
Inside your checkout page (`app/checkout/page.jsx`), simply call your Next.js local API route:

```javascript
'use client';

export default function CheckoutPage() {
  const handleOrderSuccess = async (customerPhone, orderId) => {
    try {
      const response = await fetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: customerPhone,
          message: `🎉 Hi! Your Walkdrobe order #${orderId} is confirmed and is being processed! Thank you for shopping with us!`,
          clientId: '7033769997' // Target Client Session ID
        })
      });

      const result = await response.json();
      if (result.success) {
        console.log('WhatsApp confirmation sent successfully!');
      }
    } catch (err) {
      console.error('Failed to trigger WhatsApp notify:', err);
    }
  };

  return (
    <div>
      {/* Checkout Forms / Order Button */}
      <button onClick={() => handleOrderSuccess('+919693733147', 'WALK-8921')}>
        Complete Checkout
      </button>
    </div>
  );
}
```

---

## ⚡ Method 2: Next.js Server Action (Recommended)

Next.js Server Actions let you define secure, asynchronous functions that run strictly on the server, allowing you to invoke the WhatsApp API inline directly inside your React workflows.

### 1. Define Server Actions:
`app/checkout/actions.js`

```javascript
'use server';

export async function sendOrderNotification(customerPhone, orderId) {
  if (!customerPhone) return { success: false, error: 'Phone number required' };

  const GATEWAY_URL = 'http://localhost:10000/send';

  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.WHATSAPP_API_KEY || 'Narzo50pro@gmail.com'
      },
      body: JSON.stringify({
        clientId: '7033769997', // Your client gateway session ID
        number: customerPhone,
        message: `🎉 Order WALK-${orderId} Confirmed!\nWe have received your payment. Log into Walkdrobe to track progress.`
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Failed sending notification' };
    }

    return { success: true, messageId: data.data.messageId };

  } catch (error) {
    console.error('Server Action WhatsApp Error:', error);
    return { success: false, error: 'Network error calling Gateway' };
  }
}
```

### 2. Invoke in Client Page:
`app/checkout/page.jsx`

```javascript
'use client';

import { sendOrderNotification } from './actions';

export default function CheckoutForm() {
  const submitCheckoutForm = async (event) => {
    event.preventDefault();
    
    const customerPhone = '+919693733147';
    const activeOrderId = '9844';

    // Invoke Server Action directly like a normal JS function
    const result = await sendOrderNotification(customerPhone, activeOrderId);
    
    if (result.success) {
      alert('Order placed and WhatsApp confirmation dispatched!');
    } else {
      console.warn('WhatsApp alert failed, but order processed:', result.error);
    }
  };

  return (
    <form onSubmit={submitCheckoutForm}>
      {/* Form Fields */}
      <button type="submit">Place Order</button>
    </form>
  );
}
```

---

## 🔐 Production Best Practices

1. **Environment Variables:**
   Store your Gateway URL and API key inside your Next.js `.env.local` configuration:
   ```env
   WHATSAPP_API_KEY=Narzo50pro@gmail.com
   ```
2. **Handle Failure Gracefully:**
   Always place API calls in `try/catch` wrappers. If the WhatsApp Gateway is temporarily offline (e.g. your phone lost internet), ensure it does not break your core checkout/order creation process.
3. **Queue Messages (At Scale):**
   If your checkout processes hundreds of orders simultaneously, queue messages using a lightweight library like `bull` or `p-limit` in your Next.js backend to prevent hitting WhatsApp simultaneously.

---

## 🔄 Interactive QR Re-scan & Recovery Flow (Seamless Integration)

When a WhatsApp session is offline or disconnected, the gateway does not fail. Instead, it auto-initializes the session, places the message in a **holding queue**, and responds with a `HOLD` status accompanied by the base64 QR code.

Your application can intercept this response to render a beautiful, real-time scanner interface for the user, resuming automation automatically once scanned.

### 1. Intercepting the `HOLD` response in Next.js:
`app/api/whatsapp/route.js`

```javascript
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { phone, message, clientId } = await request.json();
    const GATEWAY_URL = 'http://localhost:10000/send';

    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.WHATSAPP_API_KEY || 'Narzo50pro@gmail.com'
      },
      body: JSON.stringify({
        clientId: clientId || '7033769997',
        number: phone,
        message: message
      })
    });

    const data = await response.json();

    // If the message is successfully dispatched OR held in queue, notify the client
    if (response.ok && data.success) {
      return NextResponse.json({
        success: true,
        status: data.status || 'SENT', // 'SENT' or 'HOLD'
        message: data.message,
        qrCodeAvailable: data.qrCodeAvailable || false,
        qrBase64: data.qrBase64 || null,
        clientId: data.clientId
      });
    }

    return NextResponse.json(
      { success: false, error: data.error || 'Failed' },
      { status: response.status }
    );
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Error' }, { status: 500 });
  }
}
```

### 2. Rendering the Interactive Scanner in React:
`app/checkout/components/WhatsAppRecoveryModal.jsx`

Here is a copy-paste-ready React UI component that renders a glassmorphic modal with micro-animations, asking the user to scan the QR, and polling status in the background to automatically resume.

```jsx
'use client';

import { useState, useEffect } from 'react';

export default function WhatsAppRecoveryModal({ clientId, initialQr, onClose, onConnected }) {
  const [qrCode, setQrCode] = useState(initialQr);
  const [state, setState] = useState('QR_REQUIRED'); // INITIALIZING, QR_REQUIRED, READY
  const [dots, setDots] = useState('');

  // Subtle loading animation effect
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll for connection status and real-time QR updates
  useEffect(() => {
    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/whatsapp/status?clientId=${clientId}`);
        const data = await res.json();

        if (isMounted && data.success) {
          setState(data.state);
          
          if (data.qrBase64) {
            setQrCode(data.qrBase64);
          }

          if (data.state === 'READY') {
            clearInterval(interval);
            setTimeout(() => {
              if (onConnected) onConnected();
            }, 1500);
          }
        }
      } catch (err) {
        console.error('Polling status failed:', err);
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [clientId, onConnected]);

  return (
    <div style={styles.backdrop}>
      <div style={styles.modalCard}>
        <div style={styles.header}>
          <h2 style={styles.title}>WhatsApp Connection Paused</h2>
          <span style={{ ...styles.badge, ...styles[`badge_${state}`] }}>
            {state.replace('_', ' ')}
          </span>
        </div>

        <p style={styles.description}>
          {state === 'READY' 
            ? '🎉 Connected! Delivering held messages now...' 
            : 'We don\'t have an active connection. Please scan this QR code inside WhatsApp to resume automatically.'}
        </p>

        {state !== 'READY' && qrCode ? (
          <div style={styles.qrContainer}>
            <img src={qrCode} alt="WhatsApp QR Code" style={styles.qrImage} />
            <span style={styles.qrFooter}>Open WhatsApp &rarr; Settings &rarr; Linked Devices</span>
          </div>
        ) : state !== 'READY' ? (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner}></div>
            <span style={styles.loadingText}>Initializing WhatsApp session{dots}</span>
          </div>
        ) : (
          <div style={styles.successContainer}>
            <svg style={styles.successIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}

        <button onClick={onClose} style={styles.closeBtn}>Close</button>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(5, 8, 15, 0.85)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
  },
  modalCard: {
    width: '100%', maxWidth: '420px', backgroundColor: '#111827',
    border: '1px solid #1f2937', borderRadius: '16px', padding: '2rem',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)', fontFamily: 'system-ui, sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center'
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '1rem' },
  title: { fontSize: '1.25rem', fontWeight: 600, color: '#f9fafb', margin: 0 },
  description: { fontSize: '0.875rem', color: '#9ca3af', lineHeight: 1.5, textAlign: 'center', marginBottom: '1.5rem' },
  badge: { fontSize: '0.75rem', fontWeight: 600, padding: '0.25rem 0.625rem', borderRadius: '6px', textTransform: 'uppercase' },
  badge_READY: { backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981' },
  badge_QR_REQUIRED: { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
  badge_INITIALIZING: { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  qrContainer: {
    backgroundColor: '#fff', padding: '1rem', borderRadius: '12px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1.5rem', border: '1px solid #1f2937'
  },
  qrImage: { width: '200px', height: '200px', display: 'block' },
  qrFooter: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.75rem', fontWeight: 500 },
  loadingContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '2rem 0' },
  spinner: {
    width: '40px', height: '40px', border: '3px solid rgba(59, 130, 246, 0.2)',
    borderTop: '3px solid #3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '1rem'
  },
  loadingText: { fontSize: '0.875rem', color: '#9ca3af' },
  successContainer: { margin: '2rem 0', display: 'flex', justifyContent: 'center' },
  successIcon: { width: '64px', height: '64px', color: '#10b981' },
  closeBtn: {
    backgroundColor: '#1f2937', color: '#f9fafb', border: 'none',
    padding: '0.625rem 1.5rem', borderRadius: '8px', fontSize: '0.875rem',
    fontWeight: 500, cursor: 'pointer', outline: 'none', transition: 'background-color 0.2s', width: '100%'
  }
};
```
