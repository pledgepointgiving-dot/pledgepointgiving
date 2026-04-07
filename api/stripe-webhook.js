const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const { org, fund } = pi.metadata || {};

    try {
      // Find org by name
      const { data: orgRow } = await SB
        .from('organizations')
        .select('id')
        .eq('name', org)
        .single();

      // Find fund by name + org
      const { data: fundRow } = orgRow
        ? await SB.from('funds').select('id').eq('org_id', orgRow.id).eq('name', fund).single()
        : { data: null };

      // Find member by email if receipt email provided
      const { data: memberRow } = pi.receipt_email
        ? await SB.from('members').select('id').eq('email', pi.receipt_email).single()
        : { data: null };

      // Record the gift
      await SB.from('gifts').insert({
        org_id:    orgRow?.id    || null,
        fund_id:   fundRow?.id   || null,
        member_id: memberRow?.id || null,
        amount:    pi.amount / 100,
        date:      new Date().toISOString().split('T')[0],
        freq:      'once',
        note:      'Stripe payment ' + pi.id,
      });

      console.log('Gift recorded:', pi.id);
    } catch (err) {
      console.error('Error recording gift:', err.message);
    }
  }

  // Handle recurring subscription payments
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      // Update next_date on recurring_gifts record
      try {
        const nextDate = new Date();
        nextDate.setMonth(nextDate.getMonth() + 1);
        await SB
          .from('recurring_gifts')
          .update({ next_date: nextDate.toISOString().split('T')[0] })
          .eq('stripe_subscription_id', invoice.subscription);
      } catch (err) {
        console.error('Error updating recurring gift:', err.message);
      }
    }
  }

  return res.status(200).json({ received: true });
};
