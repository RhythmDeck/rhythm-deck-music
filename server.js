const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Serve all static files correctly
app.use(express.static(__dirname, {
  index: false,
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filePath)) {
      res.type(path.extname(filePath));
    }
    if (filePath.endsWith('.mp4')) {
      res.type('video/mp4');
    }
  }
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Supabase
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY // service_role key if you have it
);

// Stripe
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

// FIXED ONCE AND FOR ALL — NO MORE SIGNUP CALL ON SERVER
app.post('/signup', async (req, res) => {
  const { name, email, subdomain, planDuration } = req.body;

  try {
    // 1. Find the user that the frontend already created
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserByEmail(email);

    if (authError || !authUser?.user) {
      return res.status(400).json({ message: 'User not found — please sign up first' });
    }

    const userId = authUser.user.id;

    // 2. Update profile with subdomain + plan (in case they changed it)
    await supabase.from('profiles').upsert({
      id: userId,
      name: name || 'User',
      email,
      subdomain: subdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''),
      plan: planDuration ? 'pro' : 'free',
      bio: '',
      created_at: new Date().toISOString()
    });

    // 3. Free plan? Just say success
    if (!planDuration) {
      return res.json({ success: true });
    }

    // 4. Pro plan → create Stripe session
    if (!stripe) {
      return res.status(500).json({ message: 'Stripe not configured' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: PRO_PRICE_IDS[planDuration],
        quantity: 1
      }],
      mode: 'subscription',
      customer_email: email,
      client_reference_id: userId,
      metadata: {
        supabase_user_id: userId,
        subdomain,
        name
      },
      success_url: `${process.env.RENDER_EXTERNAL_URL || req.headers.origin}/profile-admin-pro.html`,
      cancel_url: `${process.env.RENDER_EXTERNAL_URL || req.headers.origin}/signup.html`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Signup route error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Rhythm Deck LIVE on port ${PORT}`);
  console.log(`→ https://rhythm-deck-music.onrender.com`);
});