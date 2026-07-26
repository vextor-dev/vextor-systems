export const onRequestPost: PagesFunction<{ 
  SUBSCRIPTIONS_KV: KVNamespace; 
  PAYSTACK_SECRET_KEY: string; 
  RESEND_API_KEY: string; 
}> = async (context) => {
  const { request, env } = context;
  const signature = request.headers.get("x-paystack-signature") || "";
  const rawBody = await request.text();
  
  // Security Verification: Stop random internet bots from hitting your endpoint
  if (!(await verifySignature(rawBody, signature, env.PAYSTACK_SECRET_KEY))) {
    return new Response("Invalid Signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const email = payload.data?.customer?.email;

  // Handle successful subscriptions (Both standard Cards and native M-Pesa charges)
  if (payload.event === "subscription.create" || payload.event === "charge.success") {
    const sessionToken = crypto.randomUUID();

    // Map active subscriber parameters to your edge database
    await env.SUBSCRIPTIONS_KV.put(`status:${email}`, "active");
    await env.SUBSCRIPTIONS_KV.put(`token:${sessionToken}`, email);

    // Fire off a transaction Magic Link directly using Resend's API
    await fetch("https://resend.com", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "VEXTOR Systems <vault@playable.earth>",
        to: [email],
        subject: "🔒 VEXTOR Portal Access Granted",
        html: `<p>Your workspace access profile is fully active.</p>
               <p><a href="https://workers.dev{sessionToken}"><strong>Click here to authenticate into the Vault</strong></a></p>`
      })
    });
  }

  // Auto-revoke entry points instantly if a card expires or a user cancels
  if (payload.event === "subscription.disable") {
    await env.SUBSCRIPTIONS_KV.put(`status:${email}`, "revoked");
  }

  return new Response("Processed", { status: 200 });
};

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hash = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hash === signature;
}
