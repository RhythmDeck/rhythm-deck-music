const express = require('express');
const path = require('path');
const app = express();

// Webhooks first – must be before express.json() for raw body
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

app.post('/webhook/rhythm-wav', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_RHYTHM_WAV || process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`Rhythm Wav Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    if (userId) {
      const { error } = await supabase
        .from('profiles')
        .update({
          rhythm_wav_premium: true,
          rhythm_wav_subscription_id: session.subscription,
          stripe_subscription_id: session.subscription,
          subscription_status: 'active',
          payment_pending: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      if (error) {
        console.error('Failed to update Rhythm Wav premium:', error);
      } else {
        console.log(`User ${userId} upgraded to Rhythm Wav Premium!`);
      }
    }
  }
  res.json({ received: true });
});

// Normal middleware and routes
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
// ───────────────────────────────
// TALKJS — SECURE AUTH
// ───────────────────────────────
const TalkJS = require('talkjs');
const TALKJS_APP_ID = 'tLZqiXQU';
const TALKJS_SECRET_KEY = process.env.TALKJS_SECRET_KEY;
app.post('/talkjs-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session' });
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single();
    const talkUser = {
      id: user.id,
      name: (profile?.name || user.email.split('@')[0]).trim(),
      email: user.email,
      role: 'member'
    };
    const signature = TalkJS.signUser(talkUser, TALKJS_SECRET_KEY);
    res.json({ token: signature });
  } catch (err) {
    console.error('TalkJS token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
// ─────────────────────────────── END OF TALKJS ───────────────────────────────

// Create Stripe Checkout Session for Rhythm Wav
app.post('/create-checkout-session', async (req, res) => {
  const { priceId, userId } = req.body;

  if (!priceId) {
    return res.status(400).json({ error: 'Missing priceId' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: 'https://rhythm-deck-music.onrender.com/account-setup.html',
      cancel_url: 'https://rhythm-deck-music.onrender.com/rhythm-wav-pricing.html',
      billing_address_collection: 'required',
      metadata: { user_id: userId }  // Critical for webhook to know which user to update
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PRICE_IDS = {
  '3month-trial': 'price_1SXkS4FV6v4usVQ1oHOnpMTd',
  '1year': 'price_1SLKLEFV6v4usVQ1aUro0ZbP',
  '2year': 'price_1SLWy5FV6v4usVQ12KvuIFim',
  '3year': 'price_1SLX0IFV6v4usVQ1xsTaeCGk'
};
app.post('/signup', async (req, res) => {
  const { name, email, subdomain, planDuration } = req.body;
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
    if (!planDuration) {
      return res.json({ success: true });
    }
    if (!stripe) {
      return res.status(500).json({ message: 'Stripe not configured' });
    }
    const isTrial = planDuration === '3month-trial';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[planDuration],
        quantity: 1
      }],
      mode: isTrial ? 'payment' : 'subscription',
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Rhythm Deck LIVE on port ${PORT}`);
  console.log(`→ https://rhythm-deck-music.onrender.com`);
});