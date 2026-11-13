const { JWT } = require("google-auth-library");

let saStr = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saStr) {
    console.error("❌ CRASH ERROR: The GitHub Secret FIREBASE_SERVICE_ACCOUNT is empty.");
    process.exit(1);
}

saStr = saStr.trim();
if (saStr.startsWith("ewogIC")) {
    saStr = Buffer.from(saStr, 'base64').toString('utf8');
}

let sa;
try { sa = JSON.parse(saStr); }
catch (e) { console.error("❌ CRASH ERROR: Secret is not valid JSON."); process.exit(1); }

sa.private_key = sa.private_key.replace(/\\n/g, '\n');

// REPLACE THESE WITH YOUR ACTUAL SUPABASE URL AND ANON KEY FROM CONFIG.JS
const SUPA_URL = "YOUR_SUPABASE_URL";
const SUPA_KEY = "YOUR_SUPABASE_ANON_KEY";

(async () => {
    try {
        const res = await fetch(`${SUPA_URL}/rest/v1/fcm_tokens?select=token&enabled=eq.true`, {
            headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
        });

        const data = await res.json();
        if (Array.isArray(data)) {
            const tokens = data.map(r => r.token);
            if (tokens.length > 0) {
                const jwt = new JWT({
                    email: sa.client_email,
                    key: sa.private_key,
                    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
                });
                const { access_token } = await jwt.getAccessToken();

                // Send to individual Web Tokens
                for (const token of tokens) {
                    await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                            message: {
                                token: token,
                                notification: { title: process.argv[2] || "AI Pulse", body: process.argv[3] || "Update" },
                                webpush: { fcmOptions: { link: process.argv[4] || "https://aibuildpulse.vercel.app/" } }
                            }
                        })
                    });
                }
                console.log(`✅ Sent to ${tokens.length} Web users.`);
            }
        }

        // Send to APK Users via "all" topic
        const jwt = new JWT({
            email: sa.client_email,
            key: sa.private_key,
            scopes: ["https://www.googleapis.com/auth/cloud-platform"]
        });
        const { access_token } = await jwt.getAccessToken();

        console.log("Sending to APK users...");
        await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: {
                    topic: "all",
                    notification: { title: process.argv[2] || "AI Pulse", body: process.argv[3] || "Update" }
                }
            })
        });
        console.log(`✅ Sent to APK Broadcast.`);
    } catch (err) {
        console.error("❌ CRASH ERROR:", err.message);
    }
})();