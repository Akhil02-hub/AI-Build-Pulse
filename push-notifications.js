import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyBCMMrxLCzl7A157ulUF8KHUHZKtimVSIw",
    authDomain: "sanjanaias-dc2ce.firebaseapp.com",
    projectId: "sanjanaias-dc2ce",
    storageBucket: "sanjanaias-dc2ce.firebasestorage.app",
    messagingSenderId: "552428288490",
    appId: "1:552428288490:android:b66d0a61fc3b5498e49a93"
};

// ⚠️ REPLACE THIS WITH YOUR ACTUAL VAPID KEY FROM FIREBASE CONSOLE
const VAPID_KEY = "YOUR_VAPID_KEY_HERE";

const app = initializeApp(firebaseConfig);
let messaging = null;
let notificationsEnabled = false;

function showForegroundNotification(payload) {
    const title = payload.notification?.title || "AI-Build-Pulse";
    const body = payload.notification?.body || "";
    const link = payload.fcmOptions?.link || "/";

    navigator.serviceWorker.ready.then((registration) => {
        registration.showNotification(title, {
            body: body,
            icon: "/logo.png",
            data: { link: link },
        });
    });
}

async function enableNotifications() {
    try {
        if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("Browser does not support push.");
        if (!(await isSupported())) throw new Error("Firebase Messaging not supported.");

        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/firebase-messaging-sw-scope/" });
        await new Promise((resolve, reject) => {
            const worker = registration.installing || registration.waiting || registration.active;
            if (!worker) return reject(new Error("SW has no worker."));
            if (worker.state === "activated") return resolve();
            worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); });
        });

        messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });

        if (!token) throw new Error("No FCM token.");

        // Save to Supabase
        if (window.sb) {
            await window.sb.from("fcm_tokens").insert({ token: token, platform: "web" });
        }

        notificationsEnabled = true;
        onMessage(messaging, (payload) => showForegroundNotification(payload));
    } catch (error) {
        console.error("Notification error:", error);
    }
}

// Auto prompt
function checkNotificationPrompt() {
    if (!("Notification" in window) || Notification.permission === "granted" || Notification.permission === "denied") return;
    const dismissedAt = localStorage.getItem('pulse.push_prompt_dismissed');
    if (dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;

    const promptHTML = `
        <div id="pushPrompt" style="position: fixed; bottom: 20px; right: 20px; background: var(--surface); border: 1px solid var(--border); padding: 16px; border-radius: 12px; box-shadow: var(--shadow-lg); z-index: 9999; max-width: 320px; display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <strong style="color: var(--text); font-size: 1rem;">🔔 Stay Updated</strong>
                <button id="closePushPrompt" style="background: none; border: none; cursor: pointer; font-size: 1.2rem; color: var(--muted); padding: 0;">&times;</button>
            </div>
            <p style="font-size: 0.85rem; color: var(--muted); margin: 0;">Get daily AI engineering and founder news directly on your device.</p>
            <button id="enablePushPrompt" style="padding: 8px 16px; font-size: 0.9rem; width: 100%; cursor: pointer; border-radius: 8px; background: var(--accent); color: white; border: none;">Enable Notifications</button>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', promptHTML);

    document.getElementById('closePushPrompt').addEventListener('click', () => {
        document.getElementById('pushPrompt').remove();
        localStorage.setItem('pulse.push_prompt_dismissed', Date.now());
    });

    document.getElementById('enablePushPrompt').addEventListener('click', () => {
        document.getElementById('pushPrompt').remove();
        enableNotifications();
    });
}

setTimeout(checkNotificationPrompt, 3000);