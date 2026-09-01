import Link from "next/link";

import styles from "./error.module.css";

type AtlasAuthErrorPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AtlasAuthErrorPage({ searchParams }: AtlasAuthErrorPageProps) {
  const params = searchParams ? await searchParams : {};
  const reason = first(params.reason);

  if (reason === "access_decommissioned") {
    return (
      <main className={styles.page}>
        <section className={styles.card} aria-labelledby="atlas-auth-error-title">
          <p className={styles.eyebrow}>Atlas</p>
          <h1 id="atlas-auth-error-title">This account is currently decommissioned.</h1>
          <p>The authentication identity has been preserved, but Atlas access is turned off during the product reset.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="atlas-auth-error-title">
        <p className={styles.eyebrow}>Atlas invitation</p>
        <h1 id="atlas-auth-error-title">This invitation link did not open.</h1>
        <p>
          The link may be incomplete, expired, or attached to a different email address.
        </p>
        <Link href="/login">Open Atlas login</Link>
      </section>
    </main>
  );
}
