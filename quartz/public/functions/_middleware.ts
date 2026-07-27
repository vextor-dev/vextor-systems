export const onRequest: PagesFunction<{ SUBSCRIPTIONS_KV: KVNamespace }> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  
  // ── 1. STATIC ASSETS: always pass through ──
  if (/\.(css|js|png|jpg|jpeg|svg|woff|woff2|ttf|ico|webp|json|xml|txt|map)$/i.test(url.pathname)) {
    return next();
  }
  
  // ── 2. WEBHOOK & AUTH ENDPOINTS: always pass through ──
  if (url.pathname === '/webhook' || url.pathname === '/auth') {
    return next();
  }
  
  // ── 3. MAGIC LINK: token in query string sets cookie ──
  const queryToken = url.searchParams.get("token");
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
  
  // ── 4. WHICH PATHS TO PROTECT ──
  const isProtected = url.pathname.startsWith('/content/') 
                   || url.pathname.startsWith('/premium/') 
                   || url.pathname.startsWith('/garden/');
  
  if (!isProtected) {
    return next();
  }
  
  // ── 5. CHECK COOKIE ──
  const cookieHeader = request.headers.get('Cookie') || '';
  let sessionToken: string | null = null;
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
  
  // ── 6. VALIDATE TOKEN IN KV ──
  const email = await env.SUBSCRIPTIONS_KV.get(`token:${sessionToken}`);
  if (!email) {
    return Response.redirect('https://paystack.shop/pay/dhidac7kf8', 302);
  }
  
  // ── 7. CHECK STATUS ──
  const status = await env.SUBSCRIPTIONS_KV.get(`status:${email}`);
  if (status === 'revoked') {
    return Response.redirect('https://paystack.shop/pay/dhidac7kf8', 302);
  }
  
  // ── 8. VALID PARTNER ──
  return next();
};
