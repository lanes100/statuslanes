import Link from "next/link";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebaseAdmin";
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

export default async function SettingsPage() {
  const user = await getSessionUser();

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex items-center justify-start gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <span aria-hidden="true">←</span>
            <span>Back</span>
          </Link>
          <h1 className="text-2xl font-semibold">Settings</h1>
        </header>

        <main className="flex flex-col gap-6">
          {user ? (
            <SettingsPanel />
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              Please sign in to manage settings.{" "}
              <Link href="/login" className="font-semibold text-zinc-900 underline underline-offset-4 dark:text-zinc-100">
                Go to login
              </Link>
              .
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
