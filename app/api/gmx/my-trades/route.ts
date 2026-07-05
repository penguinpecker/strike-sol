import { NextRequest, NextResponse } from "next/server";
import { getAccountTrades } from "@/lib/gmx/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 30));
  return NextResponse.json(await getAccountTrades(address, limit));
}
