// api/flutterwave-webhook.js
//
// Add this file to your Vercel project at /api/flutterwave-webhook.js, alongside
// chat.js and verify-payment.js.
//
// WHY THIS FILE EXISTS (read this before wiring it up):
// verify-payment.js only fires when the student's own browser tells us "I think
// this succeeded" - which works great for card payments (confirmed in seconds,
// student still watching the screen) but is NOT reliable for bank transfers,
// where the money can take a few minutes to actually land and the student may
// well have closed the tab or locked their phone by then.
//
// This webhook is Flutterwave calling OUR SERVER DIRECTLY the instant a payment
// truly settles - completely independent of whether the student's browser is
// still open. It's the guaranteed path; verify-payment.js is just the "instant
// unlock while you're still watching" fast path for card payments.
//
// Required Vercel environment variables (same three as verify-payment.js, plus one more):
//   FLW_SECRET_KEY        - already set for verify-payment.js
//   SUPABASE_URL          - already set for verify-payment.js
//   SUPABASE_SERVICE_KEY  - already set for verify-payment.js
//   FLW_WEBHOOK_HASH      - a secret phrase YOU make up (e.g. a long random string).
//                           You set this exact same phrase in TWO places: here as
//                           an env var, and in Flutterwave's dashboard under
//                           Settings -> Webhooks -> "Secret Hash". Flutterwave sends
//                           it back in every webhook call so we can confirm the
//                           call genuinely came from Flutterwave and not an impostor.
//
// SETUP IN FLUTTERWAVE DASHBOARD:
//   1. Settings -> Webhooks
//   2. Set the URL to: https://YOUR-DOMAIN.vercel.app/api/flutterwave-webhook
//   3. Set a Secret Hash (any long random string you choose) - put the SAME value
//      in the FLW_WEBHOOK_HASH environment variable in Vercel.
//   4. Save.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const FLW_WEBHOOK_HASH = process.env.FLW_WEBHOOK_HASH;

  if (!FLW_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !FLW_WEBHOOK_HASH) {
    console.error("Missing required environment variables for webhook handler");
    return res.status(500).json({ success: false, error: "Server misconfigured" });
  }

  // Confirm this request genuinely came from Flutterwave, not a random impostor
  // hitting our public URL with a fake "payment succeeded" message.
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== FLW_WEBHOOK_HASH) {
    return res.status(401).json({ success: false, error: "Invalid signature" });
  }

  const event = req.body;

  try {
    // Only act on a genuinely successful charge event.
    if (!event || event.event !== "charge.completed" || !event.data || event.data.status !== "successful") {
      // Not an event we need to act on (e.g. a failed or pending charge) - acknowledge
      // it anyway so Flutterwave doesn't keep retrying, but do nothing further.
      return res.status(200).json({ success: true, note: "Event ignored (not a completed successful charge)" });
    }

    const tx = event.data;
    const meta = tx.meta || {};
    const username = meta.username;
    const subjectIdsRaw = meta.subject_ids;

    if (!username || !subjectIdsRaw) {
      console.error("Webhook missing expected meta fields", meta);
      return res.status(200).json({ success: true, note: "Missing meta fields, cannot process" });
    }

    // Re-verify directly with Flutterwave's own API before trusting anything in the
    // webhook body itself - the same discipline as verify-payment.js, never skipped.
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${tx.id}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || verifyData.status !== "success" || verifyData.data.status !== "successful") {
      return res.status(200).json({ success: true, note: "Could not independently verify - not granting" });
    }

    const subjectIds = subjectIdsRaw.split(",").filter(Boolean);

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gce_grant_entitlements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_username: username,
        p_subject_ids: subjectIds,
        p_amount_kobo: Math.round(verifyData.data.charged_amount * 100),
        p_payment_ref: tx.tx_ref,
        p_provider: "flutterwave",
      }),
    });

    const rpcData = await rpcRes.json();
    if (!rpcRes.ok || !rpcData.success) {
      console.error("gce_grant_entitlements failed from webhook", rpcData);
      return res.status(500).json({ success: false, error: "Verified but could not grant access" });
    }

    return res.status(200).json({ success: true, granted: subjectIds });
  } catch (err) {
    console.error("flutterwave-webhook error", err);
    return res.status(500).json({ success: false, error: "Unexpected server error" });
  }
}
