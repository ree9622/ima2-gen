import { useEffect, useState } from "react";

export interface AgyStatus {
  installed: boolean;
}

// Antigravity CLI (`agy`) install detection. Login state is NOT detectable
// (agy has no status command), so this only reports whether the binary exists.
export function useAgyStatus(): AgyStatus | null {
  const [status, setStatus] = useState<AgyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/api/agy/status");
        if (cancelled) return;
        const data: AgyStatus = await res.json();
        setStatus(data);
      } catch {
        if (!cancelled) setStatus({ installed: false });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
