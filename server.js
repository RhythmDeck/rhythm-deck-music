const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public')); // This serves signup.html, index.html, etc.

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Your real Stripe Price IDs (replace these with yours!)
const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

// SIGNUP ROUTE — FINAL WORKING VERSION
app.post('/signup', async (req, res) => {
  const { email, password, name, subdomain, planDuration } = req.body;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name || 'User',
          subdomain: subdomain,
          planDuration: planDuration || null
        }
      }
    });

    if (error) throw error;

    // Profile is auto-created by the trigger → we do NOTHING here

    // Free plan = instant success
    if (!planDuration || planDuration === 'free') {
      return res.json({ success: true });
    }

    // Pro plan → go to Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: PRO_PRICE_IDS[planDuration],
          quantity: 1,
        },
      ],
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

// Fallback for all other routes (so /signup, /login, etc. work)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});