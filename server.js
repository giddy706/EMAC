require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const USERS_FILE = path.join(__dirname, 'users.json');
const TRAFFIC_FILE = path.join(__dirname, 'traffic.json');

// Payment Environment Configuration
const IS_PROD = process.env.PAYMENT_ENV === 'production';
const MPESA_URL = IS_PROD ? process.env.MPESA_PROD_URL : process.env.MPESA_SANDBOX_URL;

// Helper to read users
function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Helper to save users
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper to read traffic
function readTraffic() {
  try {
    const data = fs.readFileSync(TRAFFIC_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Helper to save traffic
function saveTraffic(traffic) {
  fs.writeFileSync(TRAFFIC_FILE, JSON.stringify(traffic, null, 2));
}

// ===============================
// 0. TRAFFIC LOGGING MIDDLEWARE
// ===============================
app.use(async (req, res, next) => {
  // Only log page views (HTML files or root)
  if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html')) && !req.path.includes('admin')) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const traffic = readTraffic();
    
    // Simple deduplication: don't log the same IP for the same path in the last 5 minutes
    const now = new Date();
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const recentVisit = traffic.find(v => v.ip === ip && v.path === req.path && new Date(v.timestamp) > fiveMinsAgo);

    if (!recentVisit) {
      let location = 'Unknown';
      try {
        // Simple GeoIP lookup (ip-api.com)
        // Note: In local dev, this might return 'Reserved' for localhost IPs
        const geoRes = await axios.get(`http://ip-api.com/json/${ip.split(',')[0]}`);
        if (geoRes.data && geoRes.data.status === 'success') {
          location = `${geoRes.data.city}, ${geoRes.data.country}`;
        }
      } catch (e) {
        // Silent fail for geoip
      }

      traffic.push({
        timestamp: now.toISOString(),
        path: req.path,
        ip: ip,
        location: location
      });
      saveTraffic(traffic);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname)));

// ===============================
// 1. REGISTER USER
// ===============================
app.post('/api/register', (req, res) => {
  const { name, email, password, loanAmount, idNumber, kraPin } = req.body;
  const users = readUsers();

  if (users.find(u => u.email === email)) {
    return res.status(400).send('Email already registered');
  }

  const newUser = {
    name,
    email,
    password, // In production, hash this!
    idNumber,
    kraPin,
    loanAmount,
    paymentStatus: 'pending',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  res.status(201).json({ message: 'User registered successfully', email });
});
// ===============================
// 4. MEGAPAY STK PUSH
// ===============================
app.post('/megapay/pay', async (req, res) => {
  const { phone, amount, userEmail } = req.body;

  try {
    const response = await axios.post(
      'https://megapay.co.ke/backend/v1/initiatestk',
      {
        api_key: process.env.MEGAPAY_API_KEY,
        email: process.env.MEGAPAY_EMAIL,
        amount: amount || 1300,
        msisdn: phone,
        reference: `EMAC-${Date.now()}`
      },
      {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://megapay.co.ke/'
        }
      }
    );

    console.log(`[MEGAPAY] STK Push initiated for ${phone}. Amount: ${amount || 10}`);
    console.log('[MEGAPAY] Response Data:', JSON.stringify(response.data, null, 2));

    // Store the checkout request ID against this user so we can verify later
    if (userEmail && response.data) {
      const users = readUsers();
      const user = users.find(u => u.email === userEmail);
      if (user) {
        user.checkoutRequestId = response.data.CheckoutRequestID || response.data.checkout_request_id;
        user.paymentStatus = 'awaiting';
        saveUsers(users);
        console.log(`[MEGAPAY] CheckoutRequestID tracked for ${userEmail}`);
      }
    }

    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('[MEGAPAY] ERROR:', err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
    const errorMsg = err.response && err.response.data && err.response.data.errorMessage 
      ? err.response.data.errorMessage 
      : err.message;
    res.status(500).json({ error: errorMsg });
  }
});

// ===============================
// 4b. CHECK MEGAPAY PAYMENT STATUS
// ===============================
app.get('/megapay/status/:email', (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.email === req.params.email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ paymentStatus: user.paymentStatus });
});

// ===============================
// 5. M-PESA TOKEN
// ===============================
async function getMpesaToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const res = await axios.get(
    `${MPESA_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` }
    }
  );

  return res.data.access_token;
}

// ===============================
// 6. M-PESA STK PUSH
// ===============================
app.post('/mpesa/pay', async (req, res) => {
  const { phone, amount } = req.body;

  try {
    const token = await getMpesaToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);

    const password = Buffer.from(
      process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp
    ).toString('base64');

    const response = await axios.post(
      `${MPESA_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.CALLBACK_URL,
        AccountReference: 'EMAC',
        TransactionDesc: 'Payment'
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 7. MEGAPAY CALLBACK (Webhook)
// ===============================
app.post('/callback', (req, res) => {
  console.log('MegaPay Callback:', JSON.stringify(req.body, null, 2));

  try {
    const body = req.body;
    // MegaPay sends ResultCode 0 for success
    const resultCode = body.ResultCode || body.result_code;
    const checkoutId = body.CheckoutRequestID || body.checkout_request_id;

    if (String(resultCode) === '0' && checkoutId) {
      const users = readUsers();
      const user = users.find(u => u.checkoutRequestId === checkoutId);
      if (user) {
        user.paymentStatus = 'paid';
        user.paidAt = new Date().toISOString();
        saveUsers(users);
        console.log(`Payment confirmed for ${user.email}`);
      }
    }
  } catch (e) {
    console.error('Callback parse error:', e.message);
  }

  res.json({ message: 'Received' });
});

// ===============================
// 8. ADMIN API
// ===============================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, token: 'fake-admin-token-' + Date.now() });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Admin Stats
app.get('/api/admin/stats', (req, res) => {
  const users = readUsers();
  const traffic = readTraffic();

  const totalUsers = users.length;
  const totalPaid = users.filter(u => u.paymentStatus === 'paid').length;
  const totalRevenue = totalPaid * 1300;

  // Aggregate traffic by day (last 7 days)
  const trafficByDay = {};
  const locationStats = {};

  traffic.forEach(entry => {
    const day = entry.timestamp.split('T')[0];
    trafficByDay[day] = (trafficByDay[day] || 0) + 1;

    const loc = entry.location || 'Unknown';
    locationStats[loc] = (locationStats[loc] || 0) + 1;
  });

  res.json({
    totalUsers,
    totalPaid,
    totalRevenue,
    totalVisits: traffic.length,
    trafficByDay,
    locationStats
  });
});

// Admin Applications (Users)
app.get('/api/admin/applications', (req, res) => {
  const users = readUsers();
  // Return users sorted by newest first
  res.json(users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// ===============================
// 9. START SERVER
// ===============================
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log('-------------------------------------------');
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌐 Mode: ${IS_PROD ? 'PRODUCTION (LIVE)' : 'SANDBOX (TEST)'}`);
  console.log(`🔗 M-Pesa URL: ${MPESA_URL}`);
  console.log('-------------------------------------------');
});
