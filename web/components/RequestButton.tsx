"use client";

import { useState } from "react";

export function RequestButton({ toolId }: { toolId: string }) {
  const [state, setState] = useState<"idle" | "submitting" | "queued" | "error" | "rate-limited">("idle");
  const [message, setMessage] = useState<string>("");

  const onClick = async () => {
    setState("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/request-wrapper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_id: toolId, recaptcha_token: "stub" }),
      });
      if (res.status === 429) {
        setState("rate-limited");
        const body = await res.json().catch(() => ({}));
        setMessage(body.message || "Rate limit hit. Try again tomorrow.");
        return;
      }
      if (!res.ok) {
        setState("error");
        setMessage(`server returned ${res.status}`);
        return;
      }
      const body = await res.json();
      setState("queued");
      setMessage(`Job ${body.job_id?.slice(0, 8)} queued — ETA ${body.estimated_wait_minutes ?? "?"} min`);
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const labelMap: Record<typeof state, string> = {
    idle: "Request Claude wrapper",
    submitting: "Queueing…",
    queued: "Queued ✓",
    error: "Try again",
    "rate-limited": "Rate limited",
  };

  const stateColor = {
    idle: "bg-accent/90 hover:bg-accent text-bg",
    submitting: "bg-bg-subtle text-ink-muted cursor-wait",
    queued: "bg-grade-a/80 text-bg",
    error: "bg-grade-d/80 text-bg",
    "rate-limited": "bg-grade-c/80 text-bg",
  }[state];

  return (
    <div className="space-y-2">
      <button
        onClick={onClick}
        disabled={state === "submitting" || state === "queued"}
        className={`px-4 py-2 rounded font-medium text-sm transition ${stateColor}`}
      >
        {labelMap[state]}
      </button>
      {message && (
        <p className="text-xs text-ink-muted">{message}</p>
      )}
    </div>
  );
}
