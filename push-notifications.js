import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getMessaging,
    getToken,
    onMessage,
    isSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyBCMMrxLCzl7A157ulUF8KHUHZKtimVSIw",
    authDomain: "sanjanaias-dc2ce.firebaseapp.com",
    projectId: "sanjanaias-dc2ce",
    storageBucket: "sanjanaias-dc2ce.firebasestorage.app",
    messagingSenderId: "552428288490",
    appId: "1:552428288490:android:b66d0a61fc3b5498e49a93"
};

const VAPID_KEY = "YOUR_VAPID_KEY_HERE"; // Put your Firebase Web Push Certificate key here

const app = initializeApp(firebaseConfig);
let messaging = null;
let notificationsEnabled = false;

const button = document.getElementById("enableNotifications");
const statusEl = document.getElementById("notificationStatus");

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}

function showForegroundNotification(payload) {
    const title = payload.notification?.title || "AI-Build-Pulse";
    const body = payload.notification?.body || "";
    const link = payload.fcmOptions?.link || "/";

    navigator.serviceWorker.ready
        .then((registration) => {
            registration.showNotification(title, {
                body: body,
                icon: "/logo.png",
                badge: "/logo.png",
                data: { link: link },
            });
        })
        .catch((err) => console.error("Foreground notification error:", err));
}

async function enableNotifications() {
    try {
        if (!("Notification" in window) || !("serviceWorker" in navigator)) {
            throw new Error("This browser does not support web push.");
        }

        if (!(await isSupported())) {
            throw new Error("Firebase Messaging is not supported in this browser.");
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            setStatus("Notification permission was not granted.");
            return;
        }

        setStatus("Registering device…");

        const registration = await navigator.serviceWorker.register(
            "/firebase-messaging-sw.js",
            { scope: "/firebase-messaging-sw-scope/" }
        );

        await new Promise((resolve, reject) => {
            const worker = registration.installing || registration.waiting || registration.active;
            if (!worker) { reject(new Error("Service worker registration has no worker.")); return; }
            if (worker.state === "activated") { resolve(); return; }
            worker.addEventListener("statechange", () => {
                if (worker.state === "activated") resolve();
            });
        });

        messaging = getMessaging(app);

        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration,
        });

        if (!token) throw new Error("Could not generate an FCM token.");

        console.log("FCM Token:", token);

        // Save token to Supabase
        try {
            const supabaseClient = window.sb; // We will expose this in app.js
            if (supabaseClient) {
                const { error: saveError } = await supabaseClient
                    .from("fcm_tokens")
                    .insert({ token: token, platform: "web" });
                if (saveError && saveError.code !== "23505") {
                    console.warn("Could not save token to Supabase:", saveError);
                }
            }
        } catch (saveError) {
            console.warn("Could not save token to Supabase:", saveError);
        }

        notificationsEnabled = true;
        setStatus("Notifications enabled successfully!");
        if (button) {
            button.disabled = true;
            button.textContent = "Notifications Enabled ✓";
        }

        onMessage(messaging, (payload) => {
            showForegroundNotification(payload);
        });
    } catch (error) {
        console.error("Notification error:", error);
        setStatus(error.message || "Could not enable notifications.");
    }
}

if (button) {
    button.addEventListener("click", () => {
        if (notificationsEnabled) return;
        enableNotifications();
    });
}

function checkNotificationPrompt() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    if (Notification.permission === "denied") return;

    const dismissedAt = localStorage.getItem('pulse.push_prompt_dismissed');
    if (dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;

    const promptHTML = `
        <div id="pushPrompt" style="position: fixed; bottom: 20px; right: 20px; background: var(--surface, #fff); border: 1px solid var(--border, #ddd); padding: 16px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); z-index: 9999; max-width: 320px; display: flex; flex-direction: column; gap: 12px; font-family: inherit;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <strong style="color: var(--text, #000); font-size: 1rem;">🔔 Stay Updated</strong>
                <button id="closePushPrompt" style="background: none; border: none; cursor: pointer; font-size: 1.2rem; color: var(--muted, #666); padding: 0; line-height: 1;">&times;</button>
            </div>
            <p style="font-size: 0.85rem; color: var(--muted, #666); margin: 0; line-height: 1.4;">Get daily AI engineering and founder news directly on your device.</p>
            <button id="enablePushPrompt" class="btn btn-primary" style="padding: 8px 16px; font-size: 0.9rem; width: 100%; cursor: pointer; border-radius: 8px; background: var(--accent); color: white; border: none;">Enable Notifications</button>
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkNotificationPrompt, 3000));
} else {
    setTimeout(checkNotificationPrompt, 3000);
}