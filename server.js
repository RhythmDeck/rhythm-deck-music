require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const stripeLib = require('stripe');
const app = express();

/* ─────────────────────────────────────────────
   SUPABASE
───────────────────────────────────────────── */
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ─────────────────────────────────────────────
   STRIPE
───────────────────────────────────────────── */
const stripe = stripeLib(process.env.STRIPE_SECRET_KEY);

/* ─────────────────────────────────────────────
   STRIPE WEBHOOK (MUST BE FIRST)
───────────────────────────────────────────── */
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    const data = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const userId = data.client_reference_id;
      if (userId) {
        await supabase
          .from('profiles')
          .update({
            plan: 'compressor',
            paid: true,
            term: data.metadata?.term || 1,
            subscription_end: new Date(
              Date.now() +
                (data.metadata?.term || 1) *
                  30 *
                  24 *
                  60 *
                  60 *
                  1000
            )
          })
          .eq('id', userId);
      }
    }
    if (event.type === 'customer.subscription.updated') {
      const sub = data;
      const userId = sub.metadata?.userId;
      if (userId) {
        await supabase
          .from('profiles')
          .update({
            paid: sub.status === 'active',
            subscription_end: new Date(sub.current_period_end * 1000)
          })
          .eq('id', userId);
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = data;
      const userId = sub.metadata?.userId;
      if (userId) {
        await supabase
          .from('profiles')
          .update({
            paid: false
          })
          .eq('id', userId);
      }
    }
    res.json({ received: true });
  }
);

/* ─────────────────────────────────────────────
   NORMAL MIDDLEWARE
───────────────────────────────────────────── */
app.use(express.json());

/* ─────────────────────────────────────────────
   STRIPE CHECKOUT — COMPRESSOR (BEFORE STATIC!)
───────────────────────────────────────────── */
app.post('/create-compressor-checkout', async (req, res) => {
  try {
    const { plan, email, userId } = req.body;
    let priceId;
    let term;
    if (plan === 'monthly') {
      priceId = process.env.STRIPE_COMPRESSOR_PRICE_ID_MONTHLY;
      term = 1;
    } else if (plan === 'yearly') {
      priceId = process.env.STRIPE_COMPRESSOR_PRICE_ID_YEARLY;
      term = 12;
    } else {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      metadata: {
        userId,
        term
      },
      success_url: `${process.env.BASE_URL || 'https://rhythm-deck-music.onrender.com'}/compressor.html?success=1`,
      cancel_url: `${process.env.BASE_URL || 'https://rhythm-deck-music.onrender.com'}/compressor-signup.html?canceled=1`
    });
    console.log('Checkout session created for user:', userId, 'plan:', plan);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Stripe checkout failed' });
  }
});

/* ─────────────────────────────────────────────
   ENSURE PROFILE
───────────────────────────────────────────── */
app.post('/ensure-profile', async (req, res) => {
  const { userId, email, name } = req.body;
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single();
  if (!data) {
    await supabase.from('profiles').insert({
      id: userId,
      email,
      name,
      plan: 'free',
      paid: false
    });
  }
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────
   ACCESS CHECK — COMPRESSOR
───────────────────────────────────────────── */
app.get('/api/check-compressor-access', async (req, res) => {
  const userId = req.query.userId;
  const { data } = await supabase
    .from('profiles')
    .select('paid, plan')
    .eq('id', userId)
    .single();
  if (!data || !data.paid || data.plan !== 'compressor') {
    return res.status(403).json({ allowed: false });
  }
  res.json({ allowed: true });
});

/* ─────────────────────────────────────────────
   STATIC FILES & FALLBACK – MUST BE LAST
───────────────────────────────────────────── */
app.use(express.static(__dirname));

/* ───────────────────────────────────────────── */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});