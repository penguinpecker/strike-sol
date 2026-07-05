import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live positions are read client-side (the close path reads the Reader directly). This endpoint is
// a stable placeholder that returns an empty list so any legacy caller degrades gracefully.
export async function GET() {
  return NextResponse.json({ positions: [] });
}
