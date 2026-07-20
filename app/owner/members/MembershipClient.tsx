"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { AtlasMemberDirectory } from "@/lib/atlas-data/members";
import styles from "./members.module.css";

function roleLabel(role: string) {
  if (role === "farm_hand") return "Farm Hand";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function MembershipClient({
  directory,
  invitesEnabled,
}: {
  directory: AtlasMemberDirectory;
  invitesEnabled: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState("farm_hand");
  const [working, setWorking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function prepareInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setMessage("");

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/atlas/owner/members/invites", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        farmId: directory.farmId,
        email: form.get("email"),
        displayName: form.get("displayName"),
        role: form.get("role"),
        workerKey: form.get("workerKey"),
      }),
    });

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error ?? "Atlas could not prepare that invitation.");
      setWorking(false);
      return;
    }

    event.currentTarget.reset();
    setRole("farm_hand");
    setMessage("Invitation prepared. No email has been sent.");
    setWorking(false);
    router.refresh();
  }

  async function sendInvite(inviteId: string) {
    setSending(inviteId);
    setError("");
    setMessage("");

    const response = await fetch(
      `/api/atlas/owner/members/invites/${encodeURIComponent(inviteId)}/send`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmId: directory.farmId }),
      },
    );

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error ?? "Atlas could not send that invitation.");
      setSending(null);
      return;
    }

    setMessage("Invitation sent.");
    setSending(null);
    router.refresh();
  }

  async function revokeInvite(inviteId: string) {
    setRemoving(inviteId);
    setError("");
    setMessage("");

    const response = await fetch(
      `/api/atlas/owner/members/invites/${encodeURIComponent(inviteId)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmId: directory.farmId }),
      },
    );

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error ?? "Atlas could not remove that invitation draft.");
      setRemoving(null);
      return;
    }

    setMessage("Invitation draft removed.");
    setRemoving(null);
    router.refresh();
  }

  return (
    <div className={styles.content}>
      <section className={styles.section} aria-labelledby="current-members-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>Active access</p>
            <h2 id="current-members-title">Farm members</h2>
          </div>
          <span>{directory.memberships.length}</span>
        </div>

        <div className={styles.list}>
          {directory.memberships.map((member) => (
            <article className={styles.card} key={member.record_id}>
              <div>
                <strong>{member.display_name}</strong>
                <p>{member.email}</p>
              </div>
              <div className={styles.cardMeta}>
                <span>{roleLabel(member.role)}</span>
                {member.worker_key ? <span>{member.worker_key}</span> : null}
                <span>{member.status}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="invite-drafts-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.kicker}>{invitesEnabled ? "Owner controlled" : "Sending disabled"}</p>
            <h2 id="invite-drafts-title">Invitations</h2>
          </div>
          <span>{directory.inviteDrafts.length}</span>
        </div>

        <div className={styles.list}>
          {directory.inviteDrafts.length ? (
            directory.inviteDrafts.map((invite) => {
              const editable = invite.status === "draft" || invite.status === "error";
              return (
                <article className={styles.card} key={invite.record_id}>
                  <div>
                    <strong>{invite.display_name}</strong>
                    <p>{invite.email}</p>
                  </div>
                  <div className={styles.cardMeta}>
                    <span>{roleLabel(invite.role)}</span>
                    {invite.worker_key ? <span>{invite.worker_key}</span> : null}
                    <span>{invite.status}</span>
                    {editable ? (
                      <button
                        type="button"
                        disabled={!invitesEnabled || sending === invite.record_id}
                        onClick={() => void sendInvite(invite.record_id)}
                      >
                        {!invitesEnabled
                          ? "Send unavailable"
                          : sending === invite.record_id
                            ? "Sending…"
                            : "Send"}
                      </button>
                    ) : null}
                    {editable ? (
                      <button
                        type="button"
                        disabled={removing === invite.record_id}
                        onClick={() => void revokeInvite(invite.record_id)}
                      >
                        {removing === invite.record_id ? "Removing…" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <p className={styles.empty}>No invitations have been prepared.</p>
          )}
        </div>
      </section>

      <section className={`${styles.section} ${styles.formSection}`} aria-labelledby="prepare-invite-title">
        <p className={styles.kicker}>Owner control</p>
        <h2 id="prepare-invite-title">Prepare an invitation</h2>
        <p className={styles.explainer}>
          This records the intended farm role. Preparing a draft never sends an email.
        </p>

        <form className={styles.form} onSubmit={prepareInvite}>
          <label>
            <span>Name</span>
            <input name="displayName" type="text" autoComplete="name" required />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Farm role</span>
            <select name="role" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="farm_hand">Farm Hand</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <label>
            <span>Worker key {role === "farm_hand" ? "" : "(optional)"}</span>
            <input
              name="workerKey"
              type="text"
              placeholder={role === "farm_hand" ? "anna" : "marshall"}
              required={role === "farm_hand"}
            />
          </label>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {message ? <p className={styles.success} role="status">{message}</p> : null}

          <button className={styles.submit} type="submit" disabled={working}>
            {working ? "Preparing…" : "Prepare invitation"}
          </button>
        </form>
      </section>
    </div>
  );
}
