const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());

// THIS IS THE ONLY LINE YOU NEED FOR STATIC FILES
// Serves everything in root: index.html, about.html, images, videos, etc.
app.use(express.static(__dirname));

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Your real Stripe Price IDs
const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

// SIGNUP → STRIPE CHECKOUT (WORKS PERFECTLY)
app.post('/signup', async (req, res) => {
  const { email, password, name, subdomain, planDuration } = req.body;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name || 'User',
          subdomain: subdomain || null,
          planDuration: planDuration || null
        }
      }
    });

    if (error) throw error;

    // Free plan = instant success
    if (!planDuration || planDuration === 'free') {
      return res.json({ success: true });
    }

    // Pro plan → redirect to Stripe
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

// NO CATCH-ALL NEEDED — express.static already serves all your real .html files!
// Removing the old app.get('*') was the fix for images not loading on other pages

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Live at: https://rhythm-deck-music.onrender.com`);
});