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
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 px-4 py-10 text-zinc-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex items-center justify-start gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm transition hover:bg-zinc-800"
          >
            <span aria-hidden="true">←</span>
            <span>Back</span>
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-50">Settings</h1>
        </header>

        <main className="flex flex-col gap-6">
          {user ? (
            <SettingsPanel />
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-200">
              Please sign in to manage settings.{" "}
              <Link href="/login" className="underline underline-offset-4">
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
