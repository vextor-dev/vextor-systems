export const onRequest: PagesFunction<{ SUBSCRIPTIONS_KV: KVNamespace }> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // 1. Instantly parse query string parameters for incoming Magic Link tokens
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    const email = await env.SUBSCRIPTIONS_KV.get(`token:${queryToken}`);
    if (email) {
      // Valid Token! Save to cookie and redirect to clean the browser URL bar
      const response = Response.redirect(url.origin + url.pathname, 302);
      response.headers.set(
        "Set-Cookie",
        `vextor_auth=${queryToken}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict`
      );
      return response;
    }
  }

  // 2. ENFORCED ACCESS WALL: Put the exact path to your premium folders here
  if (url.pathname.startsWith("/premium") || url.pathname.includes("seed-01-geodetic-precision")) {
    const cookieHeader = request.headers.get("Cookie") || "";
    const cookies = Object.fromEntries(cookieHeader.split(";").map(c => c.trim().split("=")));
    const sessionToken = cookies["vextor_auth"];

    if (sessionToken) {
      const associatedEmail = await env.SUBSCRIPTIONS_KV.get(`token:${sessionToken}`);
      if (associatedEmail) {
        const status = await env.SUBSCRIPTIONS_KV.get(`status:${associatedEmail}`);
        if (status === "active") {
          return next(); // Subscription verified! Serve the Quartz file safely.
        }
      }
    }

    // Access Denied: Kick unauthorized traffic back out to the main landing index page
    return Response.redirect(`https://vextor-systems.vextor-systems.workers.dev/`, 302);
  }

  // 3. Fallthrough: Let the landing page, global search assets, and public docs pass
  return next();
};

