module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text field' });
    const response = await fetch('http://5.75.225.23:3000/Dryad/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(14000) });
    if (!response.ok) throw new Error('Agent returned ' + response.status);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ text: "I'm having trouble connecting right now. Try asking about the project, Detroit's vacant land, native species, or how to get involved!", fallback: true });
  }
}
