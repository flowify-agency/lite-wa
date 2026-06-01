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
