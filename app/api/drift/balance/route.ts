import { NextRequest, NextResponse } from "next/server";
import { getSolBalance } from "@/lib/drift/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The game runs on SOL, so we only need native SOL (getBalance — fast + supported everywhere).
// The USDC-token lookup (getTokenAccountsByOwner) is dropped: it's unused and some RPCs (e.g.
// PublicNode) 504 on it, which stalled the whole balance read. On RPC failure return null (NOT 0)
// so the client keeps the last known value rather than flashing empty.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  const net = req.nextUrl.searchParams.get("network") || undefined;
  const sol = await getSolBalance(address, net).catch(() => null);
  return NextResponse.json({ usdc: null, sol });
}
