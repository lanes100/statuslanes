"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import ThemeToggle from "@/components/theme-toggle";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const router = useRouter();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === "signup" && (!acceptedPolicy || !acceptedTerms)) {
        setError("Please agree to the Privacy Policy and Terms & Conditions to create an account.");
        setLoading(false);
        return;
      }
      const auth = getFirebaseAuth();
      const appUrl =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      if (mode === "forgot") {
        await sendPasswordResetEmail(auth, email, {
          url: `${appUrl}/reset-password`,
          handleCodeInApp: true,
        });
        setError("Password reset email sent. Check your inbox (spam too).");
        setLoading(false);
        return;
      }
      const userCredential =
        mode === "login"
          ? await signInWithEmailAndPassword(auth, email, password)
          : await createUserWithEmailAndPassword(auth, email, password);

      const idToken = await userCredential.user.getIdToken();
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        throw new Error("Failed to create session");
      }

      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setSocialLoading(true);
    try {
      if (mode === "signup" && (!acceptedPolicy || !acceptedTerms)) {
        setError("Please agree to the Privacy Policy and Terms & Conditions to continue.");
        setSocialLoading(false);
        return;
      }
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        throw new Error("Failed to create session");
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setError(message);
    } finally {
      setSocialLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-50">
      <div className="absolute right-6 top-6">
        <ThemeToggle variant="icon" />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-50">
          {mode === "login" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-1 text-sm text-zinc-300">
          Use the email and password you want for Statuslanes.
        </p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-100" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-50 shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>

          {mode !== "forgot" && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-100" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-50 shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/10"
              />
            </div>
          )}

          {mode !== "forgot" && (
            <button
              type="button"
              className="text-xs text-zinc-200 underline underline-offset-4"
              onClick={() => setMode("forgot")}
            >
              Forgot password?
            </button>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          {mode === "signup" && (
            <div className="space-y-2 text-xs text-zinc-200">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acceptedPolicy}
                  onChange={(e) => setAcceptedPolicy(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-zinc-100 focus:ring-2 focus:ring-white/30"
                />
                <span>
                  I agree to the{" "}
                  <a href="/about" target="_blank" rel="noreferrer" className="font-semibold text-zinc-100 underline">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-zinc-100 focus:ring-2 focus:ring-white/30"
                />
                <span>
                  I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-zinc-100 underline">
                    Terms &amp; Conditions
                  </a>
                  .
                </span>
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-zinc-100 px-4 py-2 text-zinc-800 shadow-sm transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset email"}
          </button>
        </form>

        <div className="mt-4">
          <div className="relative my-3 flex items-center">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="px-3 text-xs uppercase tracking-[0.2em] text-zinc-500">or</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={socialLoading || (mode === "signup" && (!acceptedPolicy || !acceptedTerms))}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true" className="h-5 w-5">
              <path
                fill="#EA4335"
                d="M24 9.5c3.28 0 6.23 1.13 8.55 3.35l6.39-6.39C35.16 2.58 29.96 0 24 0 14.62 0 6.55 5.38 2.56 13.22l7.45 5.79C11.82 12.01 17.31 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.5 24.5c0-1.57-.14-3.08-.41-4.5H24v9.1h12.65c-.55 2.98-2.23 5.5-4.75 7.2l7.45 5.78C43.93 38.93 46.5 32.27 46.5 24.5z"
              />
              <path
                fill="#FBBC05"
                d="M10.01 28.41A14.5 14.5 0 0 1 9.5 24c0-1.52.26-2.99.73-4.38l-7.45-5.79A23.932 23.932 0 0 0 0 24c0 3.89.93 7.56 2.56 10.89l7.45-5.79z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.91-2.13 15.88-5.79l-7.45-5.78C30.45 37.83 27.39 39 24 39c-6.69 0-12.18-4.51-13.99-10.59l-7.45 5.79C6.55 42.62 14.62 48 24 48z"
              />
              <path fill="none" d="M0 0h48v48H0z" />
            </svg>
            {socialLoading ? "Signing in..." : "Continue with Google"}
          </button>
        </div>

        <div className="mt-4 text-sm text-zinc-300">
          {mode === "login" && (
            <button className="text-zinc-100 underline underline-offset-4" onClick={() => setMode("signup")}>
              New here? Create an account
            </button>
          )}
          {mode === "signup" && (
            <button className="text-zinc-100 underline underline-offset-4" onClick={() => setMode("login")}>
              Already have an account? Sign in
            </button>
          )}
          {mode === "forgot" && (
            <button className="text-zinc-100 underline underline-offset-4" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          )}
          <div className="mt-3 text-xs text-zinc-400">
            <a href="/about" className="underline hover:text-zinc-200">
              Privacy Policy
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
