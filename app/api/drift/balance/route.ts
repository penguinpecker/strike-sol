import { NextRequest, NextResponse } from "next/server";
import { getUsdcBalance, getSolBalance } from "@/lib/drift/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  const net = req.nextUrl.searchParams.get("network") || undefined;
  // On RPC failure return null (NOT 0) so the client keeps the last known value instead of
  // flashing "$0" and rejecting taps as if the wallet were empty.
  const [usdc, sol] = await Promise.all([
    getUsdcBalance(address, net).catch(() => null),
    getSolBalance(address, net).catch(() => null),
  ]);
  return NextResponse.json({ usdc, sol });
}
