"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const router = useRouter();
  const oobCode = params.get("oobCode");
  const [email, setEmail] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const auth = getFirebaseAuth();

  useEffect(() => {
    const verify = async () => {
      if (!oobCode) {
        setError("Invalid reset link");
        return;
      }
      try {
        const mail = await verifyPasswordResetCode(auth, oobCode);
        setEmail(mail);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Reset link is invalid or expired");
        }
      }
    };
    verify();
  }, [auth, oobCode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!oobCode) {
      setError("Invalid reset link");
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setSuccess("Password updated. Signing you in…");
      // try auto sign-in
      if (email) {
        await signInWithEmailAndPassword(auth, email, newPassword);
        router.push("/");
        router.refresh();
      } else {
        router.push("/login");
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to reset password");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-50">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-50">Reset password</h1>
        <p className="mt-1 text-sm text-zinc-300">Enter a new password for {email || "your account"}.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-100">New password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-50 shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-100">Confirm password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-50 shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-zinc-100 px-4 py-2 text-zinc-800 shadow-sm transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
