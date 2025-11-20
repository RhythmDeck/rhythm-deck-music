const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// THIS IS THE MAGIC FIX
app.use(express.static(__dirname, {
  extensions: ['html'],           // allows /about instead of /about.html
  index: false,                   // don't auto-serve index.html
  setHeaders: (res, filepath) => {
    if (filepath.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
      res.setHeader('Content-Type', 'image/' + path.extname(filepath).slice(1).toLowerCase());
    }
    if (filepath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }
}));

// Supabase
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Stripe (safe)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

// SIGNUP
app.post('/signup', async (req, res) => {
  const { email, password, name, subdomain, planDuration } = req.body;
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name || 'User', subdomain, planDuration } }
    });
    if (error) throw error;

    if (!planDuration || planDuration === 'free') {
      return res.json({ success: true });
    }

    if (!stripe) {
      return res.json({ success: true, warning: 'Stripe not configured' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: PRO_PRICE_IDS[planDuration], quantity: 1 }],
      mode: 'subscription',
      success_url: `${req.headers.origin}/profile-admin-pro.html?user_id=${data.user.id}`,
      cancel_url: `${req.headers.origin}/signup.html`,
      client_reference_id: data.user.id,
      customer_email: email,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});