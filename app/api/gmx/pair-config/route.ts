import { NextRequest, NextResponse } from "next/server";
import { getPairConfig } from "@/lib/gmx/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "BTC/USD";
  const cfg = await getPairConfig(symbol);
  if (!cfg) return NextResponse.json({ error: "unknown market" }, { status: 404 });
  return NextResponse.json(cfg);
}
