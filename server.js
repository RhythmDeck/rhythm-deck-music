const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Serve static files (HTML, images, etc.)
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

// Supabase – using only the anon key (exactly like your frontend)
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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

// FINAL WORKING /signup ROUTE – NO ADMIN API, NO PASSWORD, NO ERRORS
app.post('/signup', async (req, res) => {
  const { name, email, subdomain, planDuration } = req.body;

  try {
    // 1. Get the session from the Supabase token the browser sends automatically
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token' });
    }

    const token = authHeader.split(' ')[1];

    const { data: { user }, error: verifyError } = await supabase.auth.getUser(token);
    if (verifyError || !user) {
      return res.status(401).json({ message: 'Invalid or missing user' });
    }

    // 2. Update / create the profile with the chosen subdomain & plan
    await supabase.from('profiles').upsert({
      id: user.id,
      name: name || 'User',
      email: email,
      subdomain: subdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''),
      plan: planDuration ? 'pro' : 'free',
      bio: '',
      created_at: new Date().toISOString()
    });

    // 3. Free plan → just say OK
    if (!planDuration) {
      return res.json({ success: true });
    }

    // 4. Pro plan → Stripe checkout
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
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        subdomain,
        name
      },
      success_url: `${req.headers.origin}/profile-admin-pro.html`,
      cancel_url: `${req.headers.origin}/signup.html`
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