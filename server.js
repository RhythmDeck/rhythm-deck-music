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

// ALL PRICE IDs — including your $30 one-time trial
const PRICE_IDS = {
  '3month-trial': 'price_1SXkS4FV6v4usVQ1oHOnpMTd',  // One-time $30
  '1year': 'price_1SLKLEFV6v4usVQ1aUro0ZbP',
  '2year': 'price_1SLWy5FV6v4usVQ12KvuIFim',
  '3year': 'price_1SLX0IFV6v4usVQ1xsTaeCGk'
};

app.post('/signup', async (req, res) => {
  const { name, email, subdomain, planDuration } = req.body;
  const safeSubdomain = (subdomain || '').toString().trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  try {
    // Verify Supabase session
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error: verifyError } = await supabase.auth.getUser(token);
    if (verifyError || !user) {
      return res.status(401).json({ message: 'Invalid session' });
    }

    // Save profile
    await supabase.from('profiles').upsert({
      id: user.id,
      name: name || 'Artist',
      email,
      subdomain: safeSubdomain,
      plan: planDuration ? 'pro' : 'free',
      payment_pending: planDuration ? true : false,
      bio: '',
      created_at: new Date().toISOString()
    });

    // Free plan → done
    if (!planDuration) {
      return res.json({ success: true });
    }

    if (!stripe) {
      return res.status(500).json({ message: 'Stripe not configured' });
    }

    // Create Checkout Session — one-time for trial, subscription for others
    const isTrial = planDuration === '3month-trial';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[planDuration],
        quantity: 1
      }],
      mode: isTrial ? 'payment' : 'subscription',   // ← This fixes the redirect!
      customer_email: email,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        subdomain: safeSubdomain,
        plan_duration: planDuration
      },
      success_url: `${req.headers.origin}/profile-admin-pro.html?success=true`,
      cancel_url: `${req.headers.origin}/signup.html?cancelled=true`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// Optional webhook — keeps payment_pending = false after successful payment
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;

    await supabase.from('profiles')
      .update({ payment_pending: false })
      .eq('id', userId);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Rhythm Deck LIVE on port ${PORT}`);
  console.log(`→ https://rhythm-deck-music.onrender.com`);
});