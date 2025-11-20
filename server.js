const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));   // serves all your files perfectly

// === SUPABASE (safe) ===
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// === STRIPE – ONLY LOAD IF KEY EXISTS (prevents crash) ===
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('STRIPE_SECRET_KEY not set – Stripe checkout will be disabled');
}

const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

// SIGNUP ROUTE – now safe even without Stripe key
app.post('/signup', async (req, res) => {
  const { email, password, name, subdomain, planDuration } = req.body;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name: name || 'User', subdomain, planDuration }
      }
    });
    if (error) throw error;

    // Free plan always works
    if (!planDuration || planDuration === 'free') {
      return res.json({ success: true });
    }

    // If Stripe is not configured → still succeed but warn
    if (!stripe) {
      console.log('Stripe not configured – treating Pro signup as Free for now');
      return res.json({ success: true, warning: 'Stripe not set up – Pro features coming soon' });
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
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Live at: https://rhythm-deck-music.onrender.com`);
});