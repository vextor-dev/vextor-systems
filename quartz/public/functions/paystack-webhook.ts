export const onRequestPost: PagesFunction<{ 
  SUBSCRIPTIONS_KV: KVNamespace; 
  PAYSTACK_SECRET_KEY: string; 
  RESEND_API_KEY: string; 
}> = async (context) => {
  const { request, env } = context;
  const signature = request.headers.get("x-paystack-signature") || "";
  const rawBody = await request.text();
  
  if (!(await verifySignature(rawBody, signature, env.PAYSTACK_SECRET_KEY))) {
    return new Response("Invalid Signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const email = payload.data?.customer?.email;
  if (!email) return new Response("No email", { status: 200 });

  // ── NEW PAYMENT / NEW SUBSCRIPTION ──
  if (payload.event === "subscription.create" || payload.event === "charge.success") {
    const sessionToken = crypto.randomUUID();
    const ONE_YEAR = 31536000;

    // Write ALL THREE keys the middleware needs:
    await env.SUBSCRIPTIONS_KV.put(`token:${sessionToken}`, email, { expirationTtl: ONE_YEAR });
    await env.SUBSCRIPTIONS_KV.put(`email:${email}`, sessionToken, { expirationTtl: ONE_YEAR });
    await env.SUBSCRIPTIONS_KV.put(`status:${email}`, "active", { expirationTtl: ONE_YEAR });

    // Send welcome email with CORRECT magic link
    const magicLink = `https://vextor-systems.vextor-systems.workers.dev/`;
    
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Playable Earth <vault@playable.earth>",
        to: [email],
        subject: "🔒 Vault Access Granted",
        html: `<p>Your workspace access profile is active.</p>
               <p><a href="${magicLink}"><strong>Authenticate into the Garden</strong></a></p>
               <p>Bookmark the garden after you enter. The link keeps you logged in for one year.</p>`
      })
    });
  }

  // ── CANCELLATION / NON-RENEWAL ──
  // MUST delete the token or the partner keeps access via cookie
  if (payload.event === "subscription.disable" || payload.event === "subscription.not_renew") {
    // Find their token
    const sessionToken = await env.SUBSCRIPTIONS_KV.get(`email:${email}`);
    
    if (sessionToken) {
      await env.SUBSCRIPTIONS_KV.delete(`token:${sessionToken}`);
      await env.SUBSCRIPTIONS_KV.delete(`email:${email}`);
    }
    
    await env.SUBSCRIPTIONS_KV.put(`status:${email}`, "revoked", { expirationTtl: 31536000 });
  }

  return new Response("Processed", { status: 200 });
};

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", 
    encoder.encode(secret), 
    { name: "HMAC", hash: "SHA-512" }, 
    false, 
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hash = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return hash === signature;
        }
