import Link from "next/link";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebaseAdmin";
import LogoutButton from "@/components/logout-button";
import DeviceDashboard from "@/components/device-dashboard";
import SettingsPanel from "@/components/settings-panel";

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
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white px-4 py-10 text-zinc-900 dark:from-zinc-950 dark:to-zinc-900 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Statuslanes</p>
            <h1 className="mt-1 text-3xl font-semibold leading-tight">{user ? "Your TRMNL" : "Update your TRMNL status"}</h1>
            <p className="mt-1 text-sm text-zinc-600">
              {user ? "Manage your device status from here." : "Sign in to manage your device status."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <div className="rounded-full bg-zinc-100 px-3 py-2 text-sm text-zinc-700">{user.email}</div>
                <LogoutButton />
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black/90"
              >
                Sign in
              </Link>
            )}
          </div>
        </header>

        <main className="flex flex-col gap-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {user ? (
              <DeviceDashboard />
            ) : (
              <div className="flex flex-col gap-3">
                <Link
                  href="/login"
                  className="w-full rounded-xl bg-black px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-black/90"
                >
                  Sign in or create account
                </Link>
                <p className="text-xs text-zinc-500">We use Firebase Auth. Your session is stored in a secure cookie.</p>
              </div>
            )}
          </section>

          {user ? <SettingsPanel /> : null}
        </main>
      </div>
    </div>
  );
}
