const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 10000;
const API_KEY = 'Narzo50pro@gmail.com';
const RECIPIENT_NUMBER = '917004430152'; // Shreyas
const CLIENT_ID = '7004430152';

// Path to generated image
const imagePath = path.resolve('C:/Users/Way4U/.gemini/antigravity/brain/d452bcb4-93cc-4ec5-a819-282a9d59bd4a/whatsapp_gateway_celebration_1780418136371.png');

// Tiny valid silent MP3 base64 string (about 0.5s of silence, works perfectly as test audio)
const silentMp3Base64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQDkAAAAAAAAAGw9wrNaQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';

const postSend = (payload) => {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify({
      clientId: CLIENT_ID,
      number: RECIPIENT_NUMBER,
      ...payload
    });

    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        console.log(`[HTTP Response Status]: ${res.statusCode}`);
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve(responseBody);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(dataString);
    req.end();
  });
};

const dispatchAll = async () => {
  console.log('[Test Sender] Preparing payloads...');

  // Convert visual to base64
  let imageBase64 = '';
  if (fs.existsSync(imagePath)) {
    imageBase64 = fs.readFileSync(imagePath).toString('base64');
    console.log(`[Test Sender] Successfully loaded celebration image of size ${fs.statSync(imagePath).size} bytes.`);
  } else {
    console.warn('[Test Sender] Celebration image not found! Falling back to empty base64.');
  }

  // 1. Text Message
  console.log('\n--- 1. Sending Plain Text Message ---');
  const textRes = await postSend({
    message: 'Hello Shreyas! This is a plain text automated test message from your WhatsApp Lite Gateway. 🚀'
  });
  console.log('[Result 1]:', textRes);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 2. Attachment Only
  console.log('\n--- 2. Sending Attachment (Celebration Image Only) ---');
  const attachRes = await postSend({
    mediaBase64: imageBase64,
    mimetype: 'image/png',
    filename: 'celebration_visual.png'
  });
  console.log('[Result 2]:', attachRes);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Text with Attachment
  console.log('\n--- 3. Sending Text with Attachment (Image Caption) ---');
  const captionRes = await postSend({
    mediaBase64: imageBase64,
    mimetype: 'image/png',
    filename: 'gateway_setup.png',
    message: '🎉 Gateway Setup Success! Shreyas, check out this beautiful visual generated especially for you by Antigravity.'
  });
  console.log('[Result 3]:', captionRes);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 4. Audio Message
  console.log('\n--- 4. Sending Audio Attachment (Silent Beep) ---');
  const audioRes = await postSend({
    mediaBase64: silentMp3Base64,
    mimetype: 'audio/mp3',
    filename: 'test_tone.mp3',
    message: 'Test Audio Message (0.5s Tone)'
  });
  console.log('[Result 4]:', audioRes);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 5. Geo Location Card
  console.log('\n--- 5. Sending Geolocation Map Card ---');
  const geoRes = await postSend({
    latitude: 27.1751,
    longitude: 78.0421,
    name: 'Taj Mahal',
    address: 'Dharmapuri, Forest Colony, Tajganj, Agra, Uttar Pradesh 282001, India'
  });
  console.log('[Result 5]:', geoRes);

  console.log('\n🎉 All test payloads dispatched successfully! Please check your WhatsApp client on +917004430152.');
};

dispatchAll().catch(console.error);
