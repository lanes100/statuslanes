import Link from "next/link";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebaseAdmin";
import UserMenu from "@/components/user-menu";
import DeviceDashboard from "@/components/device-dashboard";

const SESSION_COOKIE_NAME = "statuslanes_session";

const getSessionUser = async () => {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return null;
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return { email: decoded.email ?? "", uid: decoded.uid };
  } catch {
    return null;
  }
};

export default async function Home() {
  const user = await getSessionUser();

  return (
    <div className="h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 px-4 py-10 text-zinc-50 overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-8 overflow-auto">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-[240px]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Statuslanes</p>
            <h1 className="mt-1 text-3xl font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
              {user ? "Your TRMNL" : "Update your TRMNL status"}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {user ? "Manage your device status from here." : "Sign in to manage your device status."}
            </p>
          </div>
          {user ? <UserMenu email={user.email} /> : null}
        </header>

        <main className="flex flex-col gap-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {user ? (
              <DeviceDashboard />
            ) : (
              <div className="flex flex-col gap-3">
                <Link
                  href="/login"
                  className="w-full rounded-xl bg-zinc-100 px-4 py-3 text-center text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                >
                  Sign in or create account
                </Link>
                <p className="text-xs text-zinc-500">We use Firebase Auth. Your session is stored in a secure cookie.</p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
