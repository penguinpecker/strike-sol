import { NextRequest, NextResponse } from "next/server";
import { insertReferral, supabaseConfigured } from "@/lib/supabase/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Attribute a referral: the connected player (wallet + optional handle) was referred by `referrer`
// (an X username slug). Best-effort; first-touch wins server-side. You can't refer yourself.
export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ ok: false, reason: "supabase not configured" });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad json" }, { status: 400 });
  }
  const wallet = typeof body.wallet === "string" && body.wallet.length ? body.wallet : null;
  const referrer = typeof body.referrer === "string" && body.referrer.length ? body.referrer.replace(/^@/, "") : null;
  if (!wallet || !referrer) return NextResponse.json({ ok: false, reason: "missing wallet/referrer" }, { status: 400 });
  if (!/^[A-Za-z0-9_]{1,40}$/.test(referrer)) return NextResponse.json({ ok: false, reason: "bad referrer slug" }, { status: 400 });
  const handle = typeof body.handle === "string" && body.handle.length ? body.handle : null;
  if (handle && handle.toLowerCase() === referrer.toLowerCase()) return NextResponse.json({ ok: false, reason: "self-referral" });
  const ok = await insertReferral({ referee_wallet: wallet, referee_handle: handle, referrer_handle: referrer });
  return NextResponse.json({ ok });
}
