require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe needs raw JSON for webhooks later, but normal JSON for now
app.use(express.json());

// ===============================
// PRICE → ACCESS MAP (TEST MODE)
// ===============================
const PRICE_ACCESS_MAP = {
  // Standalone Compressor
  'price_1SvOoG2WyyY6hPDEzqPOXGwl': 'compressor', // Monthly
  'price_1SvOqY2WyyY6hPDECBUHd7V4': 'compressor', // Yearly

  // Vision
  'price_1Sf0LY2WyyY6hPDEHucTW4vr': 'vision',
  'price_1Sf0NE2WyyY6hPDEe7ZT8LuP': 'vision',

  // Pro
  'price_1SXlTP2WyyY6hPDEsBDBLguI': 'pro',
  'price_1SMqWH2WyyY6hPDEkY5nO9Xv': 'pro',
  'price_1SMqXh2WyyY6hPDEWABVsPHY': 'pro',
  'price_1SMqYl2WyyY6hPDEpDcK6Uxp': 'pro',

  // Platinum
  'price_1SnGqW2WyyY6hPDEL4raVXs1': 'platinum'
};

// ===============================
// VERIFY STRIPE CHECKOUT SESSION
// ===============================
app.get('/verify-stripe', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).json({ ok: false });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price']
    });

    if (session.payment_status !== 'paid') {
      return res.json({ ok: false });
    }

    const prices = session.line_items.data.map(
      item => item.price.id
    );

    const access = prices
      .map(p => PRICE_ACCESS_MAP[p])
      .filter(Boolean);

    res.json({
      ok: true,
      access
    });

  } catch (err) {
    console.error('Stripe verify error:', err);
    res.status(500).json({ ok: false });
  }
});

// ===============================
// SERVE PUBLIC FILES
// ===============================
app.use(express.static('public'));

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Rhythm Deck backend running on port ${PORT}`);
});
