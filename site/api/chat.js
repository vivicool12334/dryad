module.exports = async function handler(req, res) {
  const allowedOrigins = ['https://dryad.vercel.app', 'https://www.dryad.land', 'https://dryad.land', 'http://localhost:3000'];
  const origin = req.headers?.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://dryad.vercel.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { text, history } = req.body || {};
    if (!text || typeof text !== 'string' || text.length > 2000) return res.status(400).json({ error: 'Invalid text input' });
    const response = await fetch('https://dashboard.dryad.land/Dryad/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, history: Array.isArray(history) ? history.slice(-20) : [] }), signal: AbortSignal.timeout(14000) });
    if (!response.ok) throw new Error('Agent returned ' + response.status);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ text: "I'm having trouble connecting right now. Try asking about the project, Detroit's vacant land, native species, or how to get involved!" });
  }
}
