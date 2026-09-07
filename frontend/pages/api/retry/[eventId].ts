import type { NextApiRequest, NextApiResponse } from 'next';

// Runs inside the Next.js server (same container network as the API), so
// API_URL's docker-compose hostname (http://api:3001) resolves here even
// though it never would in the browser that's actually submitting the form.
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const { eventId } = req.query;
  await fetch(`${API_URL}/events/${eventId}/retry`, { method: 'POST' });

  
  res.redirect(303, '/');
}
