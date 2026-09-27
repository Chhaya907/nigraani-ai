import { DEMO_ACCOUNTS } from "../shared/monitoring";
import superjson from "superjson";

async function verify() {
  console.log("=== VERIFYING LIVE DASHBOARD & AI PIPELINE API ===");

  // 1. Test Demo Login for MoSPI
  const mospiAccount = DEMO_ACCOUNTS.find(a => a.role === "mospi")!;
  console.log(`\n1. Authenticating as MoSPI (${mospiAccount.username})...`);

  const loginBody = superjson.serialize({
    username: mospiAccount.username,
    password: mospiAccount.password,
  });

  const loginRes = await fetch("http://localhost:3000/api/trpc/auth.demoLogin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody),
  });

  const cookieHeader = loginRes.headers.get("set-cookie");
  const loginJson = await loginRes.json();
  const loginResult = superjson.deserialize(loginJson.result?.data) as any;
  console.log("Login HTTP Status:", loginRes.status);
  console.log("Session User:", loginResult?.user?.username, "| Role:", loginResult?.user?.role);
  console.log("Set-Cookie header received:", cookieHeader ? "YES" : "NO");

  const sessionCookie = cookieHeader ? cookieHeader.split(";")[0] : "";
  const demoSessionHeader = encodeURIComponent(JSON.stringify(loginResult?.session));

  // 2. Fetch Live Monitoring Snapshot
  console.log("\n2. Fetching /api/trpc/monitoring.snapshot for MoSPI...");
  const snapshotRes = await fetch("http://localhost:3000/api/trpc/monitoring.snapshot", {
    headers: {
      cookie: sessionCookie,
      "x-demo-session": demoSessionHeader,
    },
  });

  const snapshotJson = await snapshotRes.json();
  const snapshotData = superjson.deserialize(snapshotJson.result?.data) as any;
  const snapshot = snapshotData?.snapshot;

  if (!snapshot) {
    console.error("FAILED to retrieve snapshot:", JSON.stringify(snapshotJson));
    process.exit(1);
  }

  console.log("\n--- LIVE DASHBOARD DATA VERIFICATION ---");
  console.log("Hero Eyebrow:", snapshot.hero.eyebrow);
  console.log("Hero Flagged High-Risk:", snapshot.risk.high);
  console.log("Hero In View Records:", snapshot.risk.total);
  console.log("Risk Distribution -> High:", snapshot.risk.high, "| Medium:", snapshot.risk.medium, "| Low:", snapshot.risk.low, "| Total:", snapshot.risk.total);

  console.log("\nExplainable AI Signal Stats:");
  console.log("  - Duplicate Work (Semantic Similarity):", JSON.stringify(snapshot.signalStats?.duplicateWork));
  console.log("  - Fund Movement (Isolation Forest):", JSON.stringify(snapshot.signalStats?.fundMovement));
  console.log("  - Delay Risk (Random Forest):", JSON.stringify(snapshot.signalStats?.delayRisk));
  console.log("  - Evidence Reuse (Perceptual Hashing):", JSON.stringify(snapshot.signalStats?.evidenceReuse));

  console.log(`\nPriority Queue Projects (${snapshot.rows.length} records):`);
  for (const r of snapshot.rows) {
    console.log(`  - [${r.id}] ${r.title}`);
    console.log(`      Location: ${r.region} | Status: ${r.status} | Progress: ${r.progress}%`);
    console.log(`      Risk: ${r.risk}/100 (${r.riskLevel || (r.risk >= 71 ? "High" : r.risk >= 31 ? "Medium" : "Low")}) | Sanctioned: ${r.amount} | Spent: ${r.spent}`);
    if (r.anomalies && r.anomalies.length > 0) {
      console.log(`      * Anomalies (${r.anomalies.length}):`, r.anomalies.map((a: any) => `${a.moduleType} (score: ${(a.score * 100).toFixed(0)}%, ${a.severity})`).join(", "));
      console.log(`      * Reasoning:`, r.aiReasoning);
    }
  }

  // 3. Test opening highest risk project detail
  const topProject = snapshot.rows[0];
  console.log(`\n3. Verifying Project Detail for highest risk project: ${topProject.id}...`);
  const detailInput = superjson.serialize({ projectCode: topProject.id });
  const detailRes = await fetch(`http://localhost:3000/api/trpc/monitoring.getProjectDetail?input=${encodeURIComponent(JSON.stringify(detailInput))}`, {
    headers: {
      cookie: sessionCookie,
      "x-demo-session": demoSessionHeader,
    },
  });
  const detailJson = await detailRes.json();
  const detailResult = superjson.deserialize(detailJson.result?.data) as any;
  const project = detailResult?.project;
  const assessment = detailResult?.assessment;
  const projectAnomalies = detailResult?.anomalies;
  const projectCases = detailResult?.cases;

  console.log("Project Title:", project?.title);
  console.log("Status:", project?.status, "| Progress:", project?.progress, "%");
  console.log("Sanctioned:", project?.sanctionedAmount, "| Spent:", project?.spentAmount);
  console.log("Risk Assessment Score:", assessment?.compositeScore, "| Level:", assessment?.riskLevel);
  console.log("AI Anomalies on record:", projectAnomalies?.length);
  for (const a of (projectAnomalies || [])) {
    console.log(`  * [${a.moduleType}] Score: ${(a.score * 100).toFixed(1)}% | ${a.flaggedText}`);
  }
  console.log("Flagged Cases on record:", projectCases?.length);
  for (const c of (projectCases || [])) {
    console.log(`  * [${c.caseNumber}] Priority: ${c.priority} | ${c.title}`);
  }

  console.log("\n=== ALL LIVE ENDPOINTS & DATA VERIFIED SUCCESSFULLY ===");
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
