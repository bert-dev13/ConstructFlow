/**
 * Removes seeded demo/sample Firestore records while keeping Auth accounts.
 *
 * Usage: npx tsx scripts/clear-demo-data.ts
 *
 * Calls the deployed admin-backed callable `clearDemoData`.
 */
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'constructflow-c82cd';
const region = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'us-central1';
const clearUrl = `https://${region}-${projectId}.cloudfunctions.net/clearDemoData`;

async function main() {
  console.log('Calling clearDemoData…');
  const response = await fetch(clearUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: {} }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Clear request failed with HTTP ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message || 'Clear function returned an error');
  }

  console.log('Demo/sample data cleared. Accounts preserved.');
  console.log(payload.result ?? {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
