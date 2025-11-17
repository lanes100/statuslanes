"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const auth = getFirebaseAuth();
      if (mode === "forgot") {
        await sendPasswordResetEmail(auth, email);
        setError("Password reset email sent. Check your inbox.");
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-50">
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
              disabled={mode === "forgot"}
            />
          </div>

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

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-black shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>
      </div>
    </div>
  );
}
