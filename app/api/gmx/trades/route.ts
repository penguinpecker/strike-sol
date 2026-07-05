import { NextRequest, NextResponse } from "next/server";
import { getRecentTrades } from "@/lib/gmx/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 40));
  return NextResponse.json(await getRecentTrades(limit));
}
