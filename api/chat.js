// Vercel serverless function: /api/chat
// Keeps the real Anthropic API key on the server only. The app (index.html)
// calls this endpoint instead of api.anthropic.com directly, so the key is
// never present in any code a visitor's browser can see.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel: Project Settings -> Environment Variables, then redeploy."
    });
    return;
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);

  } catch (err) {
    res.status(502).json({
      error: "Could not reach Anthropic's API from the server.",
      details: err && err.message ? err.message : String(err)
    });
  }
}
