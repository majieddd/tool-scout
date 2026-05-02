"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";

type Status = {
  status: "pending" | "running" | "succeeded" | "failed" | "rejected" | "unknown";
  result_url?: string | null;
  error?: string | null;
};

export default function RequestStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [status, setStatus] = useState<Status>({ status: "unknown" });
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!polling) return;
    let timer: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/status/${id}`);
        if (!res.ok) {
          setStatus({ status: "unknown", error: `${res.status}` });
          return;
        }
        const body = (await res.json()) as Status;
        setStatus(body);
        if (["succeeded", "failed", "rejected"].includes(body.status)) {
          setPolling(false);
        }
      } catch (e) {
        setStatus({ status: "unknown", error: String(e) });
      }
    };
    poll();
    timer = setInterval(poll, 8000);
    return () => clearInterval(timer);
  }, [id, polling]);

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-12">
      <h1 className="font-mono text-2xl text-ink">Wrapper request</h1>
      <p className="text-sm text-ink-muted mt-2 font-mono">job: {id}</p>

      <div className="mt-8 bg-bg-card border border-white/10 rounded-lg p-6 space-y-3">
        <p className="text-sm uppercase tracking-wide text-ink-subtle font-mono">
          Status
        </p>
        <p className="text-2xl font-mono text-ink">{status.status}</p>
        {status.status === "succeeded" && status.result_url && (
          <a
            href={status.result_url}
            className="inline-block mt-3 px-4 py-2 bg-accent/90 hover:bg-accent text-bg rounded font-medium text-sm"
            download
          >
            Download server.py
          </a>
        )}
        {status.error && (
          <p className="text-sm text-grade-d">{status.error}</p>
        )}
      </div>

      <Link href="/" className="inline-block mt-8 text-sm text-ink-muted hover:text-ink">
        ← back to catalog
      </Link>
    </div>
  );
}
