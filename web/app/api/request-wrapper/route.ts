import { NextRequest, NextResponse } from "next/server";

// Phase 11 implements full ngrok forwarding + reCAPTCHA verification + per-IP
// rate limit via Edge Config. Phase 10 stub returns a synthetic job_id so the
// UX can be tested end-to-end without the orchestrator running.

export async function POST(req: NextRequest) {
  let body: { tool_id?: string; recaptcha_token?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.tool_id) {
    return NextResponse.json({ error: "missing_tool_id" }, { status: 400 });
  }

  // Phase 11 will replace this stub with: verify reCAPTCHA, check Edge Config
  // rate limits, POST to ngrok URL with X-Scout-Secret, return real job_id.
  const job_id = `stub-${Math.random().toString(36).slice(2, 10)}`;
  return NextResponse.json({
    job_id,
    estimated_wait_minutes: 5,
    note: "Phase 10 stub: orchestrator not yet wired. Full flow lands in Phase 11.",
  });
}
