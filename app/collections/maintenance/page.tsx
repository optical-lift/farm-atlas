import { redirect } from "next/navigation";

type RetiredMaintenancePageProps = {
  searchParams: Promise<{ date?: string | string[] }>;
};

export default async function RetiredMaintenancePage({ searchParams }: RetiredMaintenancePageProps) {
  const params = await searchParams;
  const requestedDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const destination = requestedDate ? `/day?date=${encodeURIComponent(requestedDate)}` : "/day";
  redirect(destination);
}
