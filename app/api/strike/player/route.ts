import { NextRequest, NextResponse } from "next/server";
import { upsertPlayer, supabaseConfigured } from "@/lib/supabase/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upsert the connected player (by wallet). Best-effort; needs a wallet (Privy EVM users).
export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.json({ ok: false, reason: "supabase not configured" });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad json" }, { status: 400 });
  }
  const wallet = typeof body.wallet === "string" && body.wallet.length ? body.wallet : null;
  if (!wallet) return NextResponse.json({ ok: false, reason: "no wallet" }, { status: 400 });
  const ok = await upsertPlayer({
    wallet,
    handle: typeof body.handle === "string" ? body.handle : null,
    avatar: typeof body.avatar === "string" ? body.avatar : null,
  });
  return NextResponse.json({ ok });
}
