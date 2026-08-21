export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Allow', 'POST');
  return res.status(410).json({
    error: 'This legacy payment endpoint is retired. Payment links require an authenticated operator action and an approved offer scope.'
  });
}
