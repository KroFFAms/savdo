// Supabase Edge Function: eskiz-sms
// KROFF Savdo — muddati o'tgan qarzdorlarga Eskiz orqali SMS yuborish.
//
// TOKEN ILOVA ICHIDA EMAS — bu funksiya Supabase'da ishlaydi va sirlarni yashiradi.
//
// ==== 1) Supabase'da sirlarni qo'ying (Dashboard > Edge Functions > Secrets, yoki CLI) ====
//   ESKIZ_EMAIL     = eskiz.uz email
//   ESKIZ_PASSWORD  = eskiz.uz parol
//   ESKIZ_FROM      = tasdiqlangan sender (masalan "KROFF"); test uchun "4546"
//   APP_SECRET      = o'zingiz o'ylab topgan maxfiy so'z (ilova shuni yuboradi, boshqalar chaqira olmasin)
//
// ==== 2) Deploy ====
//   supabase functions deploy eskiz-sms --no-verify-jwt
//   (yoki Dashboard orqali yangi function yaratib, shu kodni joylang)
//
// ==== 3) Ilova shu manzilga POST qiladi ====
//   https://<PROJECT>.supabase.co/functions/v1/eskiz-sms
//   Body: { "secret":"APP_SECRET", "items":[ {"phone":"+99890...","message":"..."} , ... ] }

const ESKIZ = "https://notify.eskiz.uz/api";

async function eskizToken(): Promise<string> {
  const email = Deno.env.get("ESKIZ_EMAIL") ?? "";
  const password = Deno.env.get("ESKIZ_PASSWORD") ?? "";
  const fd = new FormData();
  fd.append("email", email);
  fd.append("password", password);
  const r = await fetch(`${ESKIZ}/auth/login`, { method: "POST", body: fd });
  const j = await r.json();
  const token = j?.data?.token;
  if (!token) throw new Error("Eskiz login xato: " + JSON.stringify(j).slice(0, 200));
  return token;
}

async function sendOne(token: string, from: string, phone: string, message: string) {
  const mobile = phone.replace(/[^0-9]/g, ""); // Eskiz: 998XXXXXXXXX (faqat raqam)
  const fd = new FormData();
  fd.append("mobile_phone", mobile);
  fd.append("message", message);
  fd.append("from", from);
  const r = await fetch(`${ESKIZ}/message/sms/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  return { phone: mobile, ok: r.ok, resp: j };
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    if (body.secret !== Deno.env.get("APP_SECRET")) {
      return new Response(JSON.stringify({ error: "ruxsat yo'q" }), { status: 401, headers: cors });
    }
    const items: Array<{ phone: string; message: string }> = body.items || [];
    if (!items.length) {
      return new Response(JSON.stringify({ error: "items bo'sh" }), { status: 400, headers: cors });
    }

    const from = Deno.env.get("ESKIZ_FROM") ?? "4546";
    const token = await eskizToken();

    const results = [];
    for (const it of items) {
      try {
        results.push(await sendOne(token, from, it.phone, it.message));
      } catch (e) {
        results.push({ phone: it.phone, ok: false, resp: String(e) });
      }
    }
    const sent = results.filter((x) => x.ok).length;
    return new Response(JSON.stringify({ sent, total: items.length, results }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
