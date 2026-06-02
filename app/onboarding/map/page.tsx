import Link from "next/link";

export default function MapOnboardingPage() {
  return (
    <main className="min-h-screen bg-[#f4f0e7] p-4 text-[#343747] md:p-8">
      <section className="mx-auto flex min-h-[80vh] max-w-5xl flex-col justify-between rounded-[34px] border border-[#d8d0c1] bg-[#fbf8f2] p-6 shadow-[0_10px_30px_rgba(91,84,62,0.08)] md:p-10">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#858caf]">
            Atlas onboarding
          </p>

          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
            Map builder is temporarily paused
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-[#6e6a60]">
            This draft onboarding screen has been simplified so Atlas can deploy.
            The real map builder will come back later after the farm data model,
            zones, beds, and multi-farm structure are stable.
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-[#d8d8e6] bg-white p-5">
              <p className="text-sm font-semibold text-[#555b89]">Current focus</p>
              <p className="mt-2 text-sm leading-6 text-[#6e6a60]">
                Field Mode, farm switching, shared state, and deploy stability.
              </p>
            </div>

            <div className="rounded-3xl border border-[#d8d8e6] bg-white p-5">
              <p className="text-sm font-semibold text-[#555b89]">Later</p>
              <p className="mt-2 text-sm leading-6 text-[#6e6a60]">
                Rebuild the map from the real spatial registry instead of old
                prototype zone names.
              </p>
            </div>

            <div className="rounded-3xl border border-[#d8d8e6] bg-white p-5">
              <p className="text-sm font-semibold text-[#555b89]">Status</p>
              <p className="mt-2 text-sm leading-6 text-[#6e6a60]">
                Safe placeholder. No editable geometry. No stale type checks.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-full bg-[#555b89] px-5 py-3 text-sm font-semibold text-white shadow-sm"
          >
            Back to command board
          </Link>

          <Link
            href="/field"
            className="rounded-full border border-[#d8d8e6] bg-white px-5 py-3 text-sm font-semibold text-[#555b89] shadow-sm"
          >
            Open Field Mode
          </Link>
        </div>
      </section>
    </main>
  );
}