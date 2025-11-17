require('dotenv').config();
const express = require('express');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

// === Middleware ===
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === Supabase Client ===
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// === Stripe Price IDs (1/2/3 year Pro plans) ===
const PRO_PRICE_IDS = {
  '1year': 'price_1SLKLEFV6v4usVQ1aUro0ZbP',
  '2year': 'price_1SLWy5FV6v4usVQ12KvuIFim',
  '3year': 'price_1SLX0IFV6v4usVQ1xsTaeCGk',
};

// === Validate Required Environment Variables ===
const requiredEnv = ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('Missing required environment variables:', missingEnv.join(', '));
  process.exit(1);
}

// === ROUTES ===

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Signup Page
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Success Page
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Cancel Page
app.get('/cancel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// === SIGNUP ENDPOINT ===
app.post('/signup', async (req, res) => {
  try {
    const { email, password, name, subdomain, planDuration } = req.body;

    // Validate input
    if (!email || !password || !name || !subdomain || !planDuration) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!PRO_PRICE_IDS[planDuration]) {
      return res.status(400).json({ error: 'Invalid plan duration selected' });
    }

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const user = authData.user;

    // 2. Insert profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email,
        name,
        subdomain,
        plan: 'pro',
        plan_duration: planDuration,
        paid: false,
      });

    if (profileError) {
      console.error('Profile insert failed:', profileError);
      return res.status(500).json({ error: 'Failed to create profile' });
    }

    // 3. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: PRO_PRICE_IDS[planDuration],
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `https://rhythm-deck-music.onrender.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://rhythm-deck-music.onrender.com/cancel.html`,
      client_reference_id: user.id,
      customer_email: email,
    });

    // 4. Return Stripe URL
    res.json({ url: session.url });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// FORCE REBUILD NOV 17 2025 - FIX 500 ERROR
require('dotenv').config();