// api/verify-payment.js
//
// Add this file to your existing Vercel project at /api/verify-payment.js,
// right alongside your existing /api/chat.js.
//
// Required Vercel environment variables (Project Settings -> Environment Variables):
//   FLW_SECRET_KEY        - your Flutterwave SECRET key (FLWSECK_TEST-... or FLWSECK-...)
//   SUPABASE_URL          - same value already used by chat.js / the app
//   SUPABASE_SERVICE_KEY  - a Supabase SERVICE ROLE key (NOT the anon key used client-side -
//                           this endpoint calls gce_grant_entitlements, which is safe to expose
//                           via anon too, but using the service key here keeps this endpoint
//                           consistent with "server-only secrets never touch the browser")
//
// What this endpoint does, and why each step matters:
//   1. Receives the Flutterwave transaction_id the browser got back from FlutterwaveCheckout.
//   2. NEVER trusts that value alone - a browser can fake "success" trivially. Instead it
//      calls Flutterwave's own server-side Verify Transaction endpoint using the SECRET key,
//      which only Flutterwave and this server can produce a genuine answer for.
//   3. Cross-checks the verified amount, currency, and status against what was actually
//      supposed to be charged (expected_amount) before granting anything.
//   4. Only then calls gce_grant_entitlements, which is itself idempotent on payment_ref,
//      so even a retried/duplicated call here can never double-grant.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { transaction_id, tx_ref, expected_amount, username, subject_ids } = req.body || {};

  if (!transaction_id || !tx_ref || !expected_amount || !username || !Array.isArray(subject_ids) || !subject_ids.length) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!FLW_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing required environment variables for payment verification");
    return res.status(500).json({ success: false, error: "Server misconfigured" });
  }

  try {
    // Step 1: verify the transaction directly with Flutterwave's servers.
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || verifyData.status !== "success") {
      return res.status(400).json({ success: false, error: "Could not verify transaction with Flutterwave" });
    }

    const tx = verifyData.data;

    // Step 2: cross-check everything that matters before trusting this transaction at all.
    if (tx.status !== "successful") {
      return res.status(400).json({ success: false, error: "Transaction was not successful (status: " + tx.status + ")" });
    }
    if (tx.tx_ref !== tx_ref) {
      return res.status(400).json({ success: false, error: "Transaction reference mismatch" });
    }
    if (tx.currency !== "NGN") {
      return res.status(400).json({ success: false, error: "Unexpected currency" });
    }
    // Flutterwave's charged_amount should be at least what we expected (allow tiny rounding slack).
    if (tx.charged_amount < expected_amount - 1) {
      return res.status(400).json({ success: false, error: "Charged amount does not match expected amount" });
    }

    // Step 3: only now, grant entitlements via the existing idempotent RPC.
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gce_grant_entitlements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_username: username,
        p_subject_ids: subject_ids,
        p_amount_kobo: Math.round(tx.charged_amount * 100),
        p_payment_ref: tx_ref,
        p_provider: "flutterwave",
      }),
    });

    const rpcData = await rpcRes.json();
    if (!rpcRes.ok || !rpcData.success) {
      console.error("gce_grant_entitlements failed", rpcData);
      return res.status(500).json({ success: false, error: "Payment verified but could not grant access - contact support" });
    }

    return res.status(200).json({ success: true, granted: subject_ids });
  } catch (err) {
    console.error("verify-payment error", err);
    return res.status(500).json({ success: false, error: "Unexpected server error" });
  }
}
