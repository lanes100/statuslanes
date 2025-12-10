import Link from "next/link";

export default function IftttSetupPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <span aria-hidden="true">←</span>
              <span>Back to settings</span>
            </Link>
            <h1 className="text-xl font-semibold">Set up IFTTT geofence</h1>
          </div>
        </header>

        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            Use the Webhooks action in IFTTT to trigger StatusLanes when you enter or leave a location. You&apos;ll need
            the <span className="font-semibold">IFTTT ID</span> and <span className="font-semibold">IFTTT secret</span>{" "}
            from the Settings page.
          </p>

          <ol className="list-decimal space-y-3 pl-5 text-sm text-zinc-800 dark:text-zinc-100">
            <li>
              In StatusLanes Settings, copy your <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">IFTTT ID</code>{" "}
              and <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">IFTTT secret</code>.
            </li>
            <li>
              In IFTTT, create an applet:
              <ul className="ml-4 mt-1 list-disc space-y-1 text-xs text-zinc-700 dark:text-zinc-200">
                <li>
                  <strong>If This:</strong> Location → &ldquo;You enter/exit an area&rdquo; (define your geofence).
                </li>
                <li>
                  <strong>Then That:</strong> Webhooks → &ldquo;Make a web request&rdquo;.
                </li>
              </ul>
            </li>
            <li>
              Configure the Webhook action:
              <ul className="ml-4 mt-1 list-disc space-y-1 text-xs text-zinc-700 dark:text-zinc-200">
                <li>URL: <code>https://&lt;your-domain&gt;/api/ifttt/geofence</code></li>
                <li>Method: <code>POST</code></li>
                <li>Content Type: <code>application/json</code></li>
                <li>
                  Header: <code>x-ifttt-secret: &lt;your IFTTT secret&gt;</code> (or use Bearer token with the same value)
                </li>
                <li>Body (JSON):</li>
              </ul>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-100 p-3 text-xs text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
{`{
  "iftttId": "<your IFTTT ID>",
  "statusKey": 1,
  "statusSource": "IFTTT Geofence (Home)"
}`}
              </pre>
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                Use a <code>statusKey</code> that matches one of your configured labels (1–12). Optionally include
                <code>statusLabel</code> to override the stored label.
              </p>
            </li>
            <li className="text-sm text-zinc-800 dark:text-zinc-100">
              Repeat with another applet for exit/arrival variants (e.g., map &ldquo;leave home&rdquo; to your away
              status).
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
