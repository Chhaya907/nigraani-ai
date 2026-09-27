import { DEMO_ACCOUNTS, ROLE_KEYS } from "../shared/monitoring";

const BASE_URL = "http://localhost:3000";

async function runLiveVerification() {
  console.log("=== LIVE E2E HTTP VERIFICATION ON http://localhost:3000 ===");

  // 1. Initial unauthenticated check
  console.log("\n[Test 1] Testing initial unauthenticated call to /api/trpc/auth.me...");
  const unauthRes = await fetch(`${BASE_URL}/api/trpc/auth.me?batch=1&input=%7B%7D`);
  const unauthJson = await unauthRes.json();
  const unauthUser = unauthJson[0]?.result?.data?.json;
  console.log("Unauthenticated auth.me response:", unauthUser);
  if (unauthUser !== null) {
    throw new Error(`Expected unauthenticated auth.me to return null, got ${JSON.stringify(unauthUser)}`);
  }
  console.log("✓ Unauthenticated check passed (returned null).");

  // 2. Test each of the 5 roles
  for (const roleKey of ROLE_KEYS) {
    console.log(`\n[Role Test] Testing '${roleKey}' workspace flow...`);
    const account = DEMO_ACCOUNTS.find(a => a.role === roleKey);
    if (!account) throw new Error(`Demo account not found for role: ${roleKey}`);

    // Call demoLogin mutation with tRPC superjson format
    const loginPayload = {
      "0": {
        json: {
          username: account.username,
          password: account.password,
        },
      },
    };

    const loginRes = await fetch(`${BASE_URL}/api/trpc/auth.demoLogin?batch=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginPayload),
    });

    const loginJson = await loginRes.json();
    const loginData = loginJson[0]?.result?.data?.json;
    console.log(`Login response for ${roleKey}:`, loginData);

    if (!loginData?.success || loginData?.role !== roleKey) {
      throw new Error(`Failed to log in as ${roleKey}: ${JSON.stringify(loginJson)}`);
    }

    // Inspect Set-Cookie header
    const setCookieHeader = loginRes.headers.get("set-cookie");
    console.log(`Set-Cookie header received:`, setCookieHeader);
    if (!setCookieHeader || !setCookieHeader.includes("nigraani_demo_session")) {
      throw new Error(`Missing nigraani_demo_session cookie in Set-Cookie: ${setCookieHeader}`);
    }

    if (setCookieHeader.toLowerCase().includes("samesite=none")) {
      throw new Error(`Invalid cookie: SameSite=None on HTTP is rejected by browsers! Expected SameSite=Lax.`);
    }

    // Extract cookie value for subsequent requests
    const cookiePart = setCookieHeader.split(";")[0]; // "nigraani_demo_session=..."

    // Call auth.me with the cookie
    const meRes = await fetch(`${BASE_URL}/api/trpc/auth.me?batch=1&input=%7B%7D`, {
      headers: { Cookie: cookiePart },
    });
    const meJson = await meRes.json();
    const meUser = meJson[0]?.result?.data?.json;
    console.log(`auth.me with session cookie:`, meUser);
    if (meUser?.role !== roleKey) {
      throw new Error(`Expected role ${roleKey}, got ${meUser?.role}`);
    }

    // Call protected API: monitoring.snapshot with the cookie
    const snapshotRes = await fetch(`${BASE_URL}/api/trpc/monitoring.snapshot?batch=1&input=%7B%7D`, {
      headers: { Cookie: cookiePart },
    });
    const snapshotJson = await snapshotRes.json();
    const snapshotData = snapshotJson[0]?.result?.data?.json;
    if (!snapshotData || !snapshotData.user) {
      throw new Error(`Failed to fetch protected snapshot for ${roleKey}: ${JSON.stringify(snapshotJson)}`);
    }
    console.log(`✓ Protected dashboard snapshot for ${roleKey} loaded successfully!`);
    console.log(`  User: ${snapshotData.user.name} (${snapshotData.user.roleLabel})`);
    console.log(`  KPIs count: ${snapshotData.snapshot.kpis.length}, Rows: ${snapshotData.snapshot.rows.length}`);
  }

  console.log("\n=======================================================");
  console.log("ALL 5 WORKSPACE SESSIONS TESTED AND VERIFIED ON LIVE SERVER!");
  console.log("=======================================================\n");
}

runLiveVerification().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
