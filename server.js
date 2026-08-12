const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve and normalize target URL. Enforces https:// and www. to prevent 301 redirects
let rawBaseUrl = process.env.API_BASE_URL || 'https://www.pay.cloud.or.ke/api';
if (!rawBaseUrl.startsWith('http://') && !rawBaseUrl.startsWith('https://')) {
  rawBaseUrl = `https://${rawBaseUrl}`;
}
if (rawBaseUrl.includes('://pay.cloud.or.ke')) {
  rawBaseUrl = rawBaseUrl.replace('://pay.cloud.or.ke', '://www.pay.cloud.or.ke');
}
const API_BASE_URL = rawBaseUrl.replace(/\/$/, '');

const BEARER_TOKEN = process.env.BEARER_TOKEN || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sanitize Kenyan phone numbers to 254XXXXXXXXX
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.slice(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Streamed Wallet Deposit Bot Endpoint
app.post('/api/bot/wallet-deposit', async (req, res) => {
  const { numbers, amount, reference } = req.body;

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'At least one target phone number is required.' });
  }

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid deposit amount is required.' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let token = req.headers.authorization || `Bearer ${BEARER_TOKEN}`;
  if (!token.startsWith('Bearer ')) {
    token = `Bearer ${token}`;
  }

  const sendBotMsg = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const formattedNumbers = numbers.map(formatPhoneNumber).filter((num) => num.length === 12);
  const total = formattedNumbers.length;

  sendBotMsg({
    type: 'start',
    total,
    message: `🤖 Bot initialized. Processing ${total} deposit request(s)...`
  });

  // Rate Limiting: 30 requests/min = 2000 ms delay
  const INTERVAL_MS = 2000;
  const endpoint = `${API_BASE_URL}/wallet/deposit`;

  for (let i = 0; i < formattedNumbers.length; i++) {
    const phone = formattedNumbers[i];
    const timestamp = new Date().toISOString();

    try {
      const response = await axios.post(
        endpoint,
        {
          phone,
          amount: Number(amount),
          ...(reference ? { reference } : {})
        },
        {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 10000
        }
      );

      sendBotMsg({
        type: 'log',
        status: 'SUCCESS',
        index: i + 1,
        total,
        phone,
        amount,
        reference: response.data?.reference || 'N/A',
        timestamp
      });
    } catch (error) {
      const errorDetail = error.response?.data || error.message;
      sendBotMsg({
        type: 'log',
        status: 'FAILED',
        index: i + 1,
        total,
        phone,
        amount,
        error: errorDetail,
        timestamp
      });
    }

    if (i < formattedNumbers.length - 1) {
      await delay(INTERVAL_MS);
    }
  }

  sendBotMsg({ type: 'complete', message: '🤖 Deposit Bot operation complete.' });
  res.end();
});

app.listen(PORT, () => {
  console.log(`Wallet Deposit Bot server listening on port ${PORT}`);
  console.log(`Active Target Endpoint: ${API_BASE_URL}/wallet/deposit`);
});
