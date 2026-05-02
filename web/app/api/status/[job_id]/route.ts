import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;
  // Phase 10 stub. Phase 11 forwards to the orchestrator's HTTP status surface
  // (localhost:8766 via ngrok) and returns the real job state.
  return NextResponse.json({
    status: "pending",
    job_id,
    note: "Phase 10 stub: orchestrator status not yet wired.",
  });
}
