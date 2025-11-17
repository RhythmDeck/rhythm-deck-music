const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static('public')); // serves your signup.html, profile-admin-pro.html, etc.

// Supabase client (use your own keys from Render env vars)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Your Stripe Price IDs (replace with your real ones or keep these if they match)
const PRO_PRICE_IDS = {
  '1year': 'price_1XXXXXX', // ← put your real 1-year price ID here
  '2year': 'price_1XXXXXX', // ← put your real 2-year price ID here
  '3year': 'price_1XXXXXX'  // ← put your real 3-year price ID here
};

// ========================
// SIGNUP ROUTE (FINAL VERSION)
// ========================
app.post('/signup', async (req, res) => {
  const { email, password, name, subdomain, planDuration } = req.body;

  try {
    // 1. Create user + pass data to trigger via metadata
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
    const user = data.user;

    // Profile is automatically created by the handle_new_user() trigger → no manual insert!

    // Free plan = immediate success
    if (!planDuration || planDuration === 'free') {
      return res.json({ success: true });
    }

    // Pro plan → send to Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: PRO_PRICE_IDS[planDuration],
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin}/profile-admin-pro.html?user_id=${user.id}`,
      cancel_url: `${req.headers.origin}/signup.html`,
      client_reference_id: user.id,
      customer_email: email,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Optional: simple health check
app.get('/', (req, res) => {
  res.send('Rhythm Deck server is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));