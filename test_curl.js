const { spawn } = require('child_process');
const http = require('http');

const PORT = 10000;
const API_KEY = 'Narzo50pro@gmail.com';
const TEST_CLIENT_ID = '7033769997'; // exactly 10-digits

// Helper to make HTTP requests using Node.js standard library
const request = (method, path, headers = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const isJson = res.headers['content-type'] && res.headers['content-type'].includes('application/json');
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: isJson ? JSON.parse(data) : data
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

const runTests = async () => {
  console.log('[Test Suite] Spawning WhatsApp Gateway server...');
  
  // Set env variables and spawn the server
  const serverEnv = { ...process.env, PORT: String(PORT), API_KEY: API_KEY };
  const server = spawn('node', ['index.js'], { env: serverEnv });

  // Pipe server output to console for debug visibility
  server.stdout.on('data', (data) => {
    console.log(`[Server Stdout]: ${data.toString().trim()}`);
  });

  server.stderr.on('data', (data) => {
    console.error(`[Server Stderr]: ${data.toString().trim()}`);
  });

  // Wait 4 seconds for server to start up
  await new Promise(resolve => setTimeout(resolve, 4000));

  let failed = false;

  const assert = (condition, message) => {
    if (!condition) {
      console.error(`❌ assertion failed: ${message}`);
      failed = true;
    } else {
      console.log(`✅ ${message}`);
    }
  };

  try {
    // 1. Test GET /status as JSON
    console.log('\n--- 1. Testing GET /status (JSON format) ---');
    const statusJson = await request('GET', '/status', { 'Accept': 'application/json' });
    assert(statusJson.statusCode === 200, 'GET /status returns 200 OK');
    assert(statusJson.body.success === true, 'Response body success is true');
    assert(Array.isArray(statusJson.body.clients), 'clients is an array');

    // 2. Test GET /status as HTML (browser view)
    console.log('\n--- 2. Testing GET /status (HTML format) ---');
    const statusHtml = await request('GET', '/status', { 'Accept': 'text/html' });
    assert(statusHtml.statusCode === 200, 'GET /status (HTML) returns 200 OK');
    assert(typeof statusHtml.body === 'string' && statusHtml.body.includes('<!DOCTYPE html>'), 'Response is valid HTML document');

    // 3. Test Unauthorized /register
    console.log('\n--- 3. Testing Unauthorized POST /register ---');
    const unauthReg = await request('POST', '/register', {}, { clientId: TEST_CLIENT_ID });
    assert(unauthReg.statusCode === 401, 'Unauthorized request returns 401');
    assert(unauthReg.body.success === false, 'success is false for unauthorized');

    // 4. Test Authorized /register with invalid clientId format (spaces / too short)
    console.log('\n--- 4. Testing Bad Request POST /register (invalid clientId format) ---');
    const badReg = await request('POST', '/register', { 'x-api-key': API_KEY }, { clientId: 'invalid_id_123' });
    assert(badReg.statusCode === 400, 'Invalid client ID format returns 400 Bad Request');
    assert(badReg.body.success === false, 'success is false for invalid client format');
    assert(badReg.body.error.includes('10-digit'), 'Error message warns about 10-digit requirement');

    // 5. Test Authorized /register with valid clientId
    console.log('\n--- 5. Testing Valid POST /register ---');
    const goodReg = await request('POST', '/register', { 'x-api-key': API_KEY }, { clientId: TEST_CLIENT_ID });
    assert(goodReg.statusCode === 200, 'Valid client registration returns 200 OK');
    assert(goodReg.body.success === true, 'success is true for valid registration');
    assert(goodReg.body.statusUrl.includes(`/status?clientId=${TEST_CLIENT_ID}`), 'Returns correct client status visual URL');

    // Wait a brief moment for initialization
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 6. Test GET /status for individual client ID
    console.log('\n--- 6. Testing GET /status for specific client ID ---');
    const clientStatus = await request('GET', `/status?clientId=${TEST_CLIENT_ID}`, { 'Accept': 'application/json' });
    assert(clientStatus.statusCode === 200, 'Client status returns 200 OK');
    assert(clientStatus.body.clientId === TEST_CLIENT_ID, 'Returned status client ID matches');
    assert(['INITIALIZING', 'QR_REQUIRED'].includes(clientStatus.body.state), `Client status state is initializing or needs QR (${clientStatus.body.state})`);

    // 7. Test Message Queue routing: POST /send to non-ready client
    console.log('\n--- 7. Testing POST /send queueing behavior (HOLD) ---');
    const msgPayload = {
      clientId: TEST_CLIENT_ID,
      number: '919876543210',
      message: 'Self-Testing Queue Routing 🚀'
    };
    const sendRes = await request('POST', '/send', { 'x-api-key': API_KEY }, msgPayload);
    assert(sendRes.statusCode === 200, 'Queueing message returns 200 OK');
    assert(sendRes.body.status === 'HOLD', 'Status returned is HOLD since client is not fully ready/connected');
    assert(sendRes.body.qrCodeAvailable !== undefined, 'Informs if QR code is generated/available');

    // 8. Verify the message is held in the queue
    console.log('\n--- 8. Verifying queue count increments ---');
    const afterSendStatus = await request('GET', `/status?clientId=${TEST_CLIENT_ID}`, { 'Accept': 'application/json' });
    assert(afterSendStatus.body.queuedCount === 1, `Queue count is correctly 1 (actual: ${afterSendStatus.body.queuedCount})`);

    // 9. Test Purge/Disconnect Session cleanly
    console.log('\n--- 9. Purging and Disconnecting the test session ---');
    const disconnectRes = await request('POST', '/disconnect', { 'x-api-key': API_KEY }, { clientId: TEST_CLIENT_ID });
    assert(disconnectRes.statusCode === 200, 'Disconnect session returns 200 OK');
    assert(disconnectRes.body.success === true, 'success is true for disconnect');

    // 10. Verify session no longer exists
    console.log('\n--- 10. Verifying session is purged ---');
    const postDisconnectStatus = await request('GET', `/status?clientId=${TEST_CLIENT_ID}`, { 'Accept': 'application/json' });
    assert(postDisconnectStatus.statusCode === 404, 'Status checks for a purged session return 404 Not Found');

  } catch (error) {
    console.error('Test execution failed with error:', error);
    failed = true;
  } finally {
    console.log('\n--- 11. Shutting down test server cleanly ---');
    server.kill('SIGINT');
    
    // Wait for process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (failed) {
      console.log('❌ Some tests failed. Please inspect logs.');
      process.exit(1);
    } else {
      console.log('🎉 All automated gateway tests passed successfully!');
      process.exit(0);
    }
  }
};

runTests();
