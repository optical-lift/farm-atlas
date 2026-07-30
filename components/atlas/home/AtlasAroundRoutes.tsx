import Link from "next/link";

type AtlasAroundRoutesProps = {
  canManage: boolean;
};

type RouteItem = {
  label: string;
  detail: string;
  href: string;
};

function RouteGroup({ title, items }: { title: string; items: RouteItem[] }) {
  return (
    <section className="atlas-around-routes__group">
      <h3>{title}</h3>
      <div>
        {items.map((item) => (
          <Link key={`${title}:${item.label}`} href={item.href}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <b aria-hidden="true">›</b>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function AtlasAroundRoutes({ canManage }: AtlasAroundRoutesProps) {
  const explore = [
    { label: "Week + month", detail: "Plan beyond today’s lineup", href: "/overview/week" },
    { label: "Maps", detail: "Bed, garden and room layouts", href: "/zones" },
    { label: "Production", detail: "Crops, cycles and harvest movement", href: "/production" },
  ];
  const govern = canManage
    ? [
        { label: "People + roles", detail: "Membership and authority", href: "/owner/members" },
        { label: "Farm management", detail: "Blockers, assignment and schedule risk", href: "/manage" },
        { label: "Atlas settings", detail: "Alerts, app and account controls", href: "/more" },
      ]
    : [
        { label: "Atlas settings", detail: "Alerts, app and account controls", href: "/more" },
      ];

  return (
    <aside className="atlas-around-routes" aria-labelledby="atlas-around-title">
      <header>
        <span>Keep moving</span>
        <h2 id="atlas-around-title">Around Atlas</h2>
      </header>
      <div className="atlas-around-routes__grid">
        <RouteGroup title="See more of the farm" items={explore} />
        <RouteGroup title="Govern Atlas" items={govern} />
      </div>
    </aside>
  );
}
