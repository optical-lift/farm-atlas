import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

function classes(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

type AtlasAppShellProps = Omit<ComponentPropsWithoutRef<"main">, "children"> & {
  children: ReactNode;
  frameClassName?: string;
  frameProps?: Omit<ComponentPropsWithoutRef<"section">, "children">;
};

export function AtlasAppShell({
  children,
  className,
  frameClassName,
  frameProps,
  ...mainProps
}: AtlasAppShellProps) {
  const { className: framePropsClassName, ...restFrameProps } = frameProps ?? {};
  return (
    <main className={classes("atlas-app-shell", "atlas-phone-shell", className)} {...mainProps}>
      <section
        className={classes(
          "atlas-app-frame",
          "atlas-phone",
          "atlas-dashboard-phone",
          frameClassName,
          framePropsClassName,
        )}
        {...restFrameProps}
      >
        {children}
      </section>
    </main>
  );
}

type AtlasTopBarProps = Omit<ComponentPropsWithoutRef<"header">, "children"> & {
  title: ReactNode;
  kicker?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
};

export function AtlasTopBar({
  title,
  kicker = "Atlas",
  status,
  action,
  className,
  ...props
}: AtlasTopBarProps) {
  return (
    <header className={classes("atlas-topbar", "atlas-phone-top", "atlas-dashboard-top", className)} {...props}>
      <div className="atlas-phone-brand atlas-topbar-brand">
        <span className="atlas-phone-kicker">{kicker}</span>
        <span className="atlas-phone-title">{title}</span>
      </div>
      {status ? <div className="atlas-topbar-status">{status}</div> : <span aria-hidden="true" />}
      {action ? <div className="atlas-topbar-action">{action}</div> : null}
    </header>
  );
}

type AtlasCardProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "cream" | "purple";
  as?: "article" | "section" | "div";
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

export function AtlasCard({
  children,
  className,
  variant = "default",
  as: Tag = "article",
  id,
  ariaLabel,
  ariaLabelledBy,
}: AtlasCardProps) {
  return (
    <Tag
      id={id}
      className={classes("atlas-card", `atlas-card--${variant}`, className)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </Tag>
  );
}

type AtlasSectionHeadingProps = {
  kicker?: ReactNode;
  title: ReactNode;
  count?: ReactNode;
  id?: string;
  className?: string;
};

export function AtlasSectionHeading({ kicker, title, count, id, className }: AtlasSectionHeadingProps) {
  return (
    <div className={classes("atlas-section-heading", className)}>
      <div>
        {kicker ? <span>{kicker}</span> : null}
        <h2 id={id}>{title}</h2>
      </div>
      {count !== undefined && count !== null ? <strong>{count}</strong> : null}
    </div>
  );
}

type AtlasMetricStripProps = {
  children: ReactNode;
  className?: string;
  href?: string;
  ariaLabel?: string;
};

export function AtlasMetricStrip({ children, className, href, ariaLabel }: AtlasMetricStripProps) {
  const content = <>{children}</>;
  if (href) {
    return (
      <Link href={href} className={classes("atlas-metric-strip", className)} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }
  return <div className={classes("atlas-metric-strip", className)} aria-label={ariaLabel}>{content}</div>;
}

type AtlasStateBadgeProps = {
  children: ReactNode;
  state: "ready" | "moving" | "waiting" | "blocked" | "review" | "complete" | "quiet" | "attention";
  className?: string;
};

export function AtlasStateBadge({ children, state, className }: AtlasStateBadgeProps) {
  return <span className={classes("atlas-state-badge", className)} data-atlas-state={state}>{children}</span>;
}

type AtlasFooterActionsProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactNode;
};

export function AtlasFooterActions({ children, className, ...props }: AtlasFooterActionsProps) {
  return <div className={classes("atlas-footer-actions", className)} {...props}>{children}</div>;
}
