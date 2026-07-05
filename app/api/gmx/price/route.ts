import { NextRequest, NextResponse } from "next/server";
import { getPrice } from "@/lib/gmx/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "BTC/USD";
  const price = await getPrice(symbol);
  return NextResponse.json({ symbol, price });
}
