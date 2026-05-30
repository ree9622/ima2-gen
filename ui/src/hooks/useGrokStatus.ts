import { useEffect, useState } from "react";

export interface GrokStatus {
  status: "ready" | "no_image_model" | "error" | "offline";
  models?: string[];
  reason?: string;
}

export function useGrokStatus(): GrokStatus | null {
  const [status, setStatus] = useState<GrokStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch("/api/grok/status");
        if (cancelled) return;
        const data: GrokStatus = await res.json();
        setStatus(data);
        if (data.status !== "ready") {
          timer = setTimeout(poll, 10_000);
        }
      } catch {
        if (!cancelled) setStatus({ status: "offline" });
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return status;
}
