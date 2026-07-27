// _worker.js — Edge gate for Playable Earth
// Place at repo root. Build command must copy it to public/: cp _worker.js public/

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── 1. STATIC ASSETS: serve directly ──
    if (/\.(css|js|png|jpg|jpeg|svg|woff|woff2|ttf|ico|webp|json|xml|txt|map|html)$/i.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // ── 2. WEBHOOK: Paystack events ──
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    // ── 3. AUTH ENDPOINT: magic link sets cookie ──
    if (url.pathname === '/auth') {
      const token = url.searchParams.get('token');
      if (!token) return new Response('Missing token', { status: 400 });

      const email = await env.SUBSCRIPTIONS_KV.get(`token:${token}`);
      if (!email) return new Response('Invalid or expired link', { status: 403 });

      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': `vextor_auth=${token}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
        }
      });
    }

    // ── 4. MAGIC LINK on any page: token in query string ──
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      const email = await env.SUBSCRIPTIONS_KV.get(`token:${queryToken}`);
      if (email) {
        const cleanUrl = url.origin + url.pathname;
        return new Response(null, {
          status: 302,
          headers: {
            'Location': cleanUrl,
            'Set-Cookie': `vextor_auth=${queryToken}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
          }
        });
      }
    }

    // ── 5. GATE: Protect everything except homepage ──
    const isPublic = url.pathname === '/' || url.pathname === '/index.html';
    if (isPublic) {
      return env.ASSETS.fetch(request);
    }

    // ── 6. CHECK COOKIE ──
    const cookieHeader = request.headers.get('Cookie') || '';
    let sessionToken = null;
    for (const cookie of cookieHeader.split(';')) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith('vextor_auth=')) {
        sessionToken = trimmed.slice('vextor_auth='.length);
        break;
      }
    }

    if (!sessionToken) {
      return Response.redirect('https://paystack.shop/pay/dhidac7kf8', 302);
    }

    const email = await env.SUBSCRIPTIONS_KV.get(`token:${sessionToken}`);
    if (!email) {
      return Response.redirect('https://paystack.shop/pay/dhidac7kf8', 302);
    }

    const status = await env.SUBSCRIPTIONS_KV.get(`status:${email}`);
    if (status === 'revoked') {
      return Response.redirect('https://paystack.shop/pay/dhidac7kf8', 302);
    }

    // ── 7. VALID PARTNER — serve the page ──
    return env.ASSETS.fetch(request);
  }
};

// ── WEBHOOK HANDLER ──
async function handleWebhook(request, env) {
  const signature = request.headers.get('x-paystack-signature') || '';
  const rawBody = await request.text();

  if (!(await verifySignature(rawBody, signature, env.PAYSTACK_SECRET_KEY))) {
    return new Response('Invalid Signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const email = payload.data?.customer?.email;
  if (!email) return new Response('No email', { status: 200 });

  // New payment / new subscription
  if (payload.event === 'subscription.create' || payload.event === 'charge.success') {
    const sessionToken = crypto.randomUUID();
    const ONE_YEAR = 31536000;

    await env.SUBSCRIPTIONS_KV.put(`token:${sessionToken}`, email, { expirationTtl: ONE_YEAR });
    await env.SUBSCRIPTIONS_KV.put(`email:${email}`, sessionToken, { expirationTtl: ONE_YEAR });
    await env.SUBSCRIPTIONS_KV.put(`status:${email}`, 'active', { expirationTtl: ONE_YEAR });

    const magicLink = `https://${new URL(request.url).host}/auth?token=${sessionToken}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Playable Earth <vault@playable.earth>',
        to: [email],
        subject: '🔒 Vault Access Granted',
        html: `<p>Your workspace access profile is active.</p>
               <p><a href="${magicLink}"><strong>Click to authenticate into the Garden</strong></a></p>
               <p>Bookmark the garden after you enter. You stay logged in for one year.</p>`
      })
    });
  }

  // Cancellation / non-renewal
  if (payload.event === 'subscription.disable' || payload.event === 'subscription.not_renew') {
    const sessionToken = await env.SUBSCRIPTIONS_KV.get(`email:${email}`);
    if (sessionToken) {
      await env.SUBSCRIPTIONS_KV.delete(`token:${sessionToken}`);
      await env.SUBSCRIPTIONS_KV.delete(`email:${email}`);
    }
    await env.SUBSCRIPTIONS_KV.put(`status:${email}`, 'revoked', { expirationTtl: 31536000 });
  }

  return new Response('OK', { status: 200 });
}

async function verifySignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const hash = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hash === signature;
        }
