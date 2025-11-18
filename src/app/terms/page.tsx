import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        ← Back
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Terms &amp; Conditions</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          These Terms govern your use of StatusLanes. By creating an account, you agree to these terms. We may update
          these terms and will notify you of material changes.
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <ul className="list-disc space-y-2 pl-5 text-zinc-700 dark:text-zinc-200">
          <li>
            <strong>Use of service:</strong> You may use StatusLanes to manage and display your status. Do not abuse,
            reverse-engineer, or disrupt the service.
          </li>
          <li>
            <strong>Data sources:</strong> We read calendar data (Google/ICS) to derive status updates. We do not write to
            or modify your calendars.
          </li>
          <li>
            <strong>Availability:</strong> We strive for uptime but do not guarantee uninterrupted service. Scheduled or
            unscheduled maintenance may occur.
          </li>
          <li>
            <strong>Liability:</strong> StatusLanes is provided “as is.” We are not liable for indirect or consequential
            damages arising from use of the service.
          </li>
          <li>
            <strong>Termination:</strong> You may disconnect calendars or delete your account at any time. We may suspend
            accounts that violate these terms.
          </li>
          <li>
            <strong>Contact:</strong> Questions? Email{" "}
            <a className="font-semibold underline" href="mailto:support@statuslanes.app">
              support@statuslanes.app
            </a>
            .
          </li>
        </ul>
      </div>
    </div>
  );
}
