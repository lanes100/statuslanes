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
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-[240px]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Statuslanes</p>
            <h1 className="mt-1 text-3xl font-semibold leading-tight">{user ? "Your TRMNL" : "Update your TRMNL status"}</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {user ? "Manage your device status from here." : "Sign in to manage your device status."}
            </p>
          </div>
          {user ? <UserMenu email={user.email} /> : null}
        </header>

        <main className="flex min-h-0 flex-1 flex-col pb-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {user ? (
              <DeviceDashboard />
            ) : (
              <div className="flex flex-1 flex-col gap-3">
                <Link
                  href="/login"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                >
                  Sign in or create account
                </Link>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">We use Firebase Auth. Your session is stored in a secure cookie.</p>
              </div>
            )}
          </section>
        </main>
        {!user ? (
          <footer className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/about" className="underline underline-offset-4 hover:text-zinc-700 dark:hover:text-zinc-200">
              Privacy Policy & Terms
            </Link>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
