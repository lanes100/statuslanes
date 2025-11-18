export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10 text-zinc-900 dark:text-zinc-100">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">About StatusLane</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          StatusLane connects your calendars to your TRMNL so your status updates automatically. We only ever read your
          calendar data to derive a status (busy, out of office, video, keyword match) and never write back to your
          calendars.
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Privacy Policy</h2>
        <ul className="list-disc space-y-2 pl-5 text-zinc-700 dark:text-zinc-200">
          <li>
            <strong>Data we access:</strong> Google Calendar events (read-only) or your provided ICS feed, Firebase auth
            email, and your TRMNL webhook URL.
          </li>
          <li>
            <strong>How we use it:</strong> We map event times and keywords to a status label and push that label to your
            TRMNL. We do not modify or create calendar events.
          </li>
          <li>
            <strong>Storage:</strong> We store your auth tokens, selected calendars/keywords, and a short cache of
            upcoming events to keep your status in sync between fetches.
          </li>
          <li>
            <strong>Sharing:</strong> We do not sell or share your data with third parties. Data is only used to deliver
            StatusLane features.
          </li>
          <li>
            <strong>Removal:</strong> You can disconnect Google Calendar anytime, delete your device in Settings, or
            contact us to remove your data.
          </li>
        </ul>
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-base font-semibold">Contact</h3>
        <p className="text-zinc-700 dark:text-zinc-200">
          Questions about privacy or data removal? Email us at{" "}
          <a className="font-semibold underline" href="mailto:support@statuslane.app">
            support@statuslane.app
          </a>
          .
        </p>
      </div>
    </div>
  );
}
