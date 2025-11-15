require('dotenv').config();
const express = require('express');
const path = require('path 

');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// *** WASMER REQUIRES PORT 8080 ***
const PORT = process.env.PORT || 8080;   // <-- changed from 3000 to 8080

// Middleware
app.use(express.json());
app.use(express.raw({ type: 'application/json' })); // For webhook
app.use(express.static(path.join(__dirname, 'public')));

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// === ROUTES ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ADMIN PAGE
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile-admin-pro.html'));
});

// ARTIST PAGE
app.get('/artist/:subdomain', async (req, res) => {
  const { subdomain } = req.params;
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('subdomain', subdomain)
    .single();
  if (error || !data) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'artist.html'));
});

// === SIGNUP API ===
app.post('/signup', async (req, res) => {
  const { email, password, name, subdomain } = req.body;
  try {
    // 1. Create Supabase user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });
    if (authError) throw authError;
    const user = authData.user;

    // 2. Insert profile
    await supabase.from('profiles').insert({
      id: user.id,
      email,
      name,
      subdomain,
      plan: 'pro',
      paid: false
    });

    // 3. Create Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: 'price_1SQ...', // ← REPLACE WITH YOUR PRO PRICE ID
      }],
      mode: 'subscription',
      success_url: `https://gen-lang-client-0224306493.appspot.com/admin?user_id=${user.id}`,
      cancel_url: `https://gen-lang-client-0224306493.appspot.com/signup.html`,
      client_reference_id