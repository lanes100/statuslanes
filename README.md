This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## IFTTT geofence webhook

Trigger StatusLanes from an IFTTT geofence applet:

1. Point the IFTTT Webhooks action to `POST https://statuslanes.vercel.app/api/ifttt/geofence` (or your custom domain).
2. Headers: `Content-Type: application/json` and `x-ifttt-secret: <device-ifttt-secret>`.
3. Body example:
   ```json
   {
     "iftttId": "<your-device-ifttt-id>",
     "statusKey": 1,
     "statusSource": "IFTTT Geofence (Home)"
   }
   ```
   - `iftttId` is a random per-device token stored on the device document (use this instead of the Firebase deviceId). If a device is missing one, it will be generated on next update.
   - `statusKey` should match a configured label (1-12) so the webhook can pull the stored label for TRMNL.
   - `statusSource` is optional and defaults to "IFTTT Geofence". `statusLabel` is optional—only include it if you want to override the stored label for that key.
4. You can retrieve `iftttId` and `iftttSecret` from the authenticated `GET /api/device` response (or surface them in the UI).
