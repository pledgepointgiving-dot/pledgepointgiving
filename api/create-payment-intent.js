const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, currency = 'usd', orgName, fundName, donorEmail, stripeAccountId } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Minimum donation is $0.50' });
    }

    const params = {
      amount: Math.round(amount * 100), // convert dollars to cents
      currency,
      receipt_email: donorEmail || undefined,
      metadata: {
        org:  orgName  || '',
        fund: fundName || '',
      },
    };

    // If the church has a connected Stripe account, route money directly to them
    if (stripeAccountId) {
      params.transfer_data = { destination: stripeAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(params);

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
};
