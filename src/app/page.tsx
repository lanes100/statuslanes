import Link from "next/link";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebaseAdmin";
import LogoutButton from "@/components/logout-button";
import DeviceDashboard from "@/components/device-dashboard";

const SESSION_COOKIE_NAME = "statuslanes_session";

const getSessionUser = async () => {
  try {
    const sessionCookie = cookies().get(SESSION_COOKIE_NAME)?.value;
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
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white px-4 py-10 text-zinc-900">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Statuslanes
            </p>
            <h1 className="mt-1 text-3xl font-semibold leading-tight">
              Update your TRMNL status from anywhere
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Mobile-friendly, add to your home screen, and stay in sync with your device.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <div className="rounded-full bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
                  {user.email}
                </div>
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

        <main className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Quick start</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Set your status in a couple taps. Optimized for phones and small screens.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {user ? (
                <DeviceDashboard />
              ) : (
                <>
                  <Link
                    href="/login"
                    className="w-full rounded-xl bg-black px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-black/90"
                  >
                    Sign in or create account
                  </Link>
                  <p className="text-xs text-zinc-500">
                    We use Firebase Auth. Your session is stored in a secure cookie.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Add to your home screen</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Install Statuslanes as a standalone app for quick access.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-zinc-700">
              <li>
                <span className="font-semibold">iOS Safari:</span> Tap Share → “Add to Home Screen”.
              </li>
              <li>
                <span className="font-semibold">Android Chrome:</span> Menu → “Add to Home screen”.
              </li>
              <li>
                Uses a manifest and standalone display for an app-like experience.
              </li>
            </ul>
          </section>
        </main>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">What’s next</h2>
          <ul className="mt-3 space-y-2 text-sm text-zinc-700">
            <li>Link TRMNL devices and status buttons to your account.</li>
            <li>Send webhook updates to TRMNL with one tap.</li>
            <li>See “last updated” and status source info inline.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
