const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// THIS IS THE FIX — serve files from root + force correct MIME types
app.use(express.static(__dirname, {
  // This forces proper handling of .jpg, .png, .mp4, .html even on sub-pages
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
    }
    if (filePath.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
      res.setHeader('Content-Type', 'image/' + path.extname(filePath).slice(1));
    }
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
  }
}));

// Supabase
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Stripe (safe loading)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PRO_PRICE_IDS = {
  '1year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv',
  '2year': 'price_1SMqXh2WyyY6hPDEWABVsPHY',
  '3year': 'price_1SMqWH2WyyY6hPDEkY5nO9Xv'
};

// SIGNUP ROUTE (unchanged)
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
      return res.json({ success: true, warning: 'Pro coming soon' });
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

// NO CATCH-ALL NEEDED — static already serves everything correctly

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Live at: https://rhythm-deck-music.onrender.com`);
});