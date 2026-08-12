const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to sanitize phone numbers into 254XXXXXXXXX format
function formatPhoneNumber(phone) {
  let cleaned = phone.trim().replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  } else if (cleaned.startsWith('+254')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

// Helper delay to enforce rate limits (2000 ms = 30 req/min)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// SSE Endpoint for processing bulk batch
app.post('/api/process-bulk', async (req, res) => {
  const { phoneNumbers, amount, reference } = req.body;

  if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return res.status(400).json({ error: 'At least one phone number is required.' });
  }

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'A valid amount is required.' });
  }

  // Setup Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const total = phoneNumbers.length;
  sendSSE({ type: 'start', total });

  for (let i = 0; i < total; i++) {
    const rawPhone = phoneNumbers[i];
    const formattedPhone = formatPhoneNumber(rawPhone);

    const payload = {
      phone: formattedPhone,
      amount: Number(amount)
    };

    if (reference) {
      payload.reference = reference;
    }

    try {
      // Call CloudPay STK Push / Wallet Deposit Endpoint
      const response = await axios.post(
        'https://www.pay.cloud.or.ke/api/wallet/deposit',
        payload,
        {
          headers: {
            'X-API-Key': API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      sendSSE({
        type: 'log',
        index: i + 1,
        total,
        phone: formattedPhone,
        amount,
        status: 'SUCCESS',
        details: response.data?.message || 'STK Push sent successfully'
      });
    } catch (error) {
      sendSSE({
        type: 'log',
        index: i + 1,
        total,
        phone: formattedPhone,
        amount,
        status: 'FAILED',
        details: error.response?.data?.message || error.message || 'API request failed'
      });
    }

    // Enforce 30 requests per minute rate limit (2 seconds delay between requests)
    if (i < total - 1) {
      await delay(2000);
    }
  }

  sendSSE({ type: 'complete' });
  res.end();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
