import Link from "next/link";

type AtlasAroundRoutesProps = {
  todayIso: string;
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
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
            <b aria-hidden="true">›</b>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function AtlasAroundRoutes({ todayIso, canManage }: AtlasAroundRoutesProps) {
  const work = [
    { label: "Today", detail: "Open the current living lineup", href: `/day?date=${encodeURIComponent(todayIso)}` },
    { label: "This week", detail: "See placement across the week", href: "/overview/week" },
    { label: "Upcoming", detail: "Look beyond the immediate hand", href: "/overview/month" },
  ];
  const see = [
    { label: "Places + maps", detail: "Beds, gardens, rooms and objects", href: "/zones" },
    { label: "Projects", detail: "Open the Portfolio Matrix", href: "/#portfolio-matrix" },
    { label: "Production", detail: "Crops, cycles and active production", href: "/production" },
  ];
  const govern = canManage
    ? [
        { label: "People + roles", detail: "Membership and authority", href: "/owner/members" },
        { label: "Farm management", detail: "Blockers, assignment and schedule risk", href: "/manage" },
        { label: "Atlas settings", detail: "App, alerts and account controls", href: "/more" },
      ]
    : [
        { label: "Atlas settings", detail: "App, alerts and account controls", href: "/more" },
      ];

  return (
    <aside className="atlas-around-routes" aria-labelledby="atlas-around-title">
      <header>
        <span>Keep moving</span>
        <h2 id="atlas-around-title">Around Atlas</h2>
        <p>The farm record stays attached to its work, places, crops and projects. These are routes into that same Atlas.</p>
      </header>
      <div className="atlas-around-routes__grid">
        <RouteGroup title="Work with the farm" items={work} />
        <RouteGroup title="See the farm" items={see} />
        <RouteGroup title="Govern Atlas" items={govern} />
      </div>
    </aside>
  );
}
