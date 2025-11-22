const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

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

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

app.post('/signup', async (req, res) => {
  const { name, email, subdomain, planDuration } = req.body;

  // FIX: subdomain can be undefined for Free users → make it safe
  const safeSubdomain = (subdomain || '').toString().trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: verifyError } = await supabase.auth.getUser(token);

    if (verifyError || !user) {
      return res.status(401).json({ message: 'Invalid session' });
    }

    // Update profile — safe even if subdomain is empty
    await supabase.from('profiles').upsert({
      id: user.id,
      name: name || 'User',
      email,
      subdomain: safeSubdomain,
      plan: planDuration ? 'pro' : 'free',
      bio: '',
      created_at: new Date().toISOString()
    });

    // Free plan → done
    if (!planDuration) {
      return res.json({ success: true });
    }

    // Pro plan → Stripe
    if (!stripe) {
      return res.status(500).json({ message: 'Stripe not ready' });
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
        subdomain: safeSubdomain,
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