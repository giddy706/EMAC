require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

const USERS_FILE = path.join(__dirname, 'users.json');

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
        headers: { 'Content-Type': 'application/json' }
      }
    );

    // Store the checkout request ID against this user so we can verify later
    if (userEmail && response.data) {
      const users = readUsers();
      const user = users.find(u => u.email === userEmail);
      if (user) {
        user.checkoutRequestId = response.data.CheckoutRequestID || response.data.checkout_request_id;
        user.paymentStatus = 'awaiting';
        saveUsers(users);
      }
    }

    res.json({ success: true, data: response.data });
  } catch (err) {
    const errorMsg = err.response && err.response.data && err.response.data.errorMessage 
      ? err.response.data.errorMessage 
      : err.message;
    console.error('MegaPay Error:', err.response ? err.response.data : err.message);
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
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
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
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
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
// 8. START SERVER
// ===============================
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
