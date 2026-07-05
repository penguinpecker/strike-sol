import { NextResponse } from "next/server";
import { getMarkets } from "@/lib/gmx/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMarkets());
}
