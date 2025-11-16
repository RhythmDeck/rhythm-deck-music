require('dotenv').config();
const express = require('express');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// === ROUTES ===

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Signup Page (GET)
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Signup Form Submit (POST)
app.post('/signup', async (req, res) => {
  try {
    const { email, password, name, subdomain } = req.body;

    if (!email || !password || !name || !subdomain) {
      return res.status(400).json({ error: 'All fields are required' });
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

    // 2. Insert profile into 'profiles' table
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email,
        name,
        subdomain,
        plan: 'pro',
        paid: false,
      });

    if (profileError) {
      return res.status(500).json({ error: 'Failed to create profile' });
    }

    // 3. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID, // ← SET THIS IN .env
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `https://rhythm-deck-music.onrender.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://rhythm-deck-music.onrender.com/cancel.html`,
      client_reference_id: user.id,
      customer_email: email,
    });

    // 4. Return Stripe URL as JSON
    res.json({ url: session.url });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Optional: Success page
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Optional: Cancel page
app.get('/cancel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});