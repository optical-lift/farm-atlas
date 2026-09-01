"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./OwnerPrincipalDecisionAction.module.css";

type Props = {
  candidateKey: string;
  farmId: string;
  demandOrderId: string;
};

type ActionResponse = {
  ok?: boolean;
  error?: string;
  saleOrderId?: string;
  deduplicated?: boolean;
};

export default function OwnerPrincipalDecisionAction({ candidateKey, farmId, demandOrderId }: Props) {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function commitToSale() {
    if (saving) return;
    if (!idempotencyKey.current) {
      idempotencyKey.current = `principal:${candidateKey}:${crypto.randomUUID()}`;
    }

    try {
      setSaving(true);
      setMessage(null);
      setError(false);

      const response = await fetch("/api/atlas/flower-demand-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "convert",
          farmId,
          demandOrderId,
          taxAmount: 0,
          tipAmount: 0,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const payload = await response.json() as ActionResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Atlas could not commit this demand to Sale.");

      setMessage(payload.deduplicated
        ? "This demand was already committed to the same canonical Sale. Atlas reused it instead of creating another Sale."
        : "Sale committed. Fulfillment and payment remain separate downstream truth.");
      idempotencyKey.current = null;
      router.push("/owner");
      router.refresh();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Atlas could not commit this demand to Sale.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.action} data-principal-command="flower_demand_commit_to_sale">
      <button type="button" disabled={saving} onClick={() => void commitToSale()}>
        {saving ? "Committing Sale…" : "Commit to Sale"}
      </button>
      {message ? <output data-error={error ? "true" : "false"} aria-live="polite">{message}</output> : null}
    </div>
  );
}
