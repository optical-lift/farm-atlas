import styles from "./EmployeeBrandHeader.module.css";

type EmployeeBrandHeaderProps = {
  organizationName: string;
  organizationLogoSrc?: string | null;
};

export default function EmployeeBrandHeader({
  organizationName,
  organizationLogoSrc,
}: EmployeeBrandHeaderProps) {
  return (
    <div className={styles.brandRow}>
      <div className={styles.organizationSlot} aria-label={organizationName}>
        {organizationLogoSrc ? (
          // Logo sources are expected to be organization-controlled assets.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={organizationLogoSrc}
            alt={organizationName}
            className={styles.organizationLogo}
          />
        ) : (
          <span className={styles.organizationName}>{organizationName}</span>
        )}
      </div>

      <a
        className={styles.atlasLink}
        href="https://atlas.opticallift.com"
        target="_blank"
        rel="noreferrer"
        aria-label="Open Atlas"
        title="Atlas"
      >
        <svg className={styles.atlasMark} viewBox="0 0 500 500" aria-hidden="true">
          <g fill="currentColor">
            <path d="M112.5,222.3l-4.5-.8c-1.5-.3-2.5-1.7-2.2-3.2,13.6-68.8,73.8-118.4,144.3-118.4s67.3,11.9,93.5,33.6c25.2,20.8,42.8,49.5,49.9,81.2s-.6,2.9-2.1,3.2l-4.5.9c-1.4.3-2.9-.6-3.2-2.1-6.6-29.4-23.1-56.2-46.5-75.5-24.5-20.2-55.4-31.3-87.2-31.3-65.6,0-121.7,46.2-134.4,110.2s-1.7,2.4-3.1,2.2Z" />
            <path d="M176.2,374.2c-35.5-20.6-60.6-54.9-69.6-94.7-.3-1.5.7-3.1,2.2-3.4l4.2-.9c1.5-.3,3,.7,3.4,2.2,8.4,37,31.8,68.9,64.7,88.1,1.3.8,1.8,2.5,1.1,3.9l-2.1,3.8c-.8,1.4-2.5,1.9-3.9,1.1Z" />
            <path d="M319.4,373.8l-2.4-4.4c-.7-1.2-.2-2.7,1-3.4,33.6-19.2,57.4-51.4,65.8-89,.3-1.3,1.6-2.2,3-1.9l4.9,1c1.4.3,2.3,1.6,2,3-9,40.4-34.6,75.1-70.7,95.7-1.2.7-2.8.2-3.4-1Z" />
            <rect x="245" y="281.7" width="10" height="158.7" rx="2.7" ry="2.7" />
            <rect x="245" y="59.6" width="10" height="152.7" rx="2.9" ry="2.9" />
            <rect x="283" y="242" width="133.6" height="10" rx="2.9" ry="2.9" />
            <rect x="83.4" y="242" width="131.8" height="10" rx="2.6" ry="2.6" />
            <path d="M250,290.4l-43.4-43.4,43.4-43.4,43.4,43.4-43.4,43.4ZM220.7,247l29.3,29.3,29.3-29.3-29.3-29.3-29.3,29.3Z" />
          </g>
        </svg>
      </a>
    </div>
  );
}
