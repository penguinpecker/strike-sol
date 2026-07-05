import { NextRequest, NextResponse } from "next/server";
import { getAvaxBalance } from "@/lib/gmx/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The game runs on native AVAX, so a single eth_getBalance covers it. On RPC failure return null
// (NOT 0) so the client keeps the last known value rather than flashing an empty wallet.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  const avax = await getAvaxBalance(address).catch(() => null);
  return NextResponse.json({ avax });
}
