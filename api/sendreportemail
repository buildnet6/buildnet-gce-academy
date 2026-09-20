// api/send-report-email.js
//
// Add this file to your Vercel project's /api folder, alongside the others.
//
// Required Vercel environment variable:
//   RESEND_API_KEY - the key you already have: re_cyPXZwDn_...
//
// Sends a graded theory/essay report by email, to the student and optionally
// their guardian - the actual mark-by-mark breakdown, not just "you got 6/10."
// Uses buildnetds.com as the sending domain (already verified in Resend for
// PPCE Academy), with a distinct "from" address so BuildNET Academy's emails
// are clearly identifiable from PPCE Academy's within the same account.

const FROM_ADDRESS = "BuildNET Academy <academy@buildnetds.com>";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { toEmail, studentName, subjectName, questionText, marks, maxMarks, criteria, strengths, improve } = req.body || {};

  if (!toEmail || !subjectName || marks == null || !maxMarks) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error("Missing RESEND_API_KEY");
    return res.status(500).json({ success: false, error: "Server misconfigured" });
  }

  const criteriaRows = (criteria || []).map((c) => {
    const full = c.earned >= c.allocated;
    const zero = c.earned <= 0;
    const color = full ? "#16A34A" : zero ? "#DC2626" : "#D97706";
    return `<div style="background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:8px;border-left:4px solid ${color};">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <span style="font-size:13.5px;color:#2B2350;">${escapeHtml(c.criterion)}</span>
        <b style="color:${color};white-space:nowrap;">${c.earned}/${c.allocated}</b>
      </div>
      <div style="font-size:12.5px;color:#7C7591;margin-top:4px;">${escapeHtml(c.why || "")}</div>
    </div>`;
  }).join("");

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FAFAFF;padding:24px;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:24px;font-weight:800;color:#2B2350;">🎓 BuildNET Academy</div>
      <div style="font-size:12px;color:#7C7591;letter-spacing:1px;">GRADED THEORY & ESSAY REPORT</div>
    </div>
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:16px;">
      <div style="font-size:13px;color:#7C7591;">${escapeHtml(subjectName)}</div>
      <div style="font-size:15px;color:#2B2350;margin:6px 0 14px;">${escapeHtml(questionText || "")}</div>
      <div style="text-align:center;font-size:32px;font-weight:800;color:#7C3AED;margin:10px 0;">${marks}/${maxMarks}</div>
    </div>
    ${criteriaRows ? `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:700;color:#7C3AED;margin-bottom:8px;">MARK-BY-MARK BREAKDOWN</div>${criteriaRows}</div>` : ""}
    ${strengths ? `<div style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:12px;"><b style="color:#16A34A;font-size:12px;">WHAT YOU DID WELL</b><p style="font-size:13.5px;color:#2B2350;margin:6px 0 0;">${escapeHtml(strengths)}</p></div>` : ""}
    ${improve ? `<div style="background:#fff;border-radius:12px;padding:14px 16px;"><b style="color:#D97706;font-size:12px;">WHAT TO IMPROVE</b><p style="font-size:13.5px;color:#2B2350;margin:6px 0 0;">${escapeHtml(improve)}</p></div>` : ""}
    <div style="text-align:center;margin-top:20px;font-size:11px;color:#7C7591;">Sent because ${escapeHtml(studentName || "a student")} completed a graded practice attempt on BuildNET Academy.</div>
  </div>`;

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [toEmail],
        subject: `Graded: ${subjectName} - ${marks}/${maxMarks}`,
        html,
      }),
    });

    const data = await resendRes.json();
    if (!resendRes.ok) {
      console.error("Resend error", data);
      return res.status(502).json({ success: false, error: "Email service rejected the request" });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error("send-report-email error", err);
    return res.status(500).json({ success: false, error: "Unexpected server error" });
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
