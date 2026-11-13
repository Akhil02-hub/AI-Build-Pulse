importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyBCMMrxLCzl7A157ulUF8KHUHZKtimVSIw",
    authDomain: "sanjanaias-dc2ce.firebaseapp.com",
    projectId: "sanjanaias-dc2ce",
    storageBucket: "sanjanaias-dc2ce.firebasestorage.app",
    messagingSenderId: "552428288490",
    appId: "1:552428288490:android:b66d0a61fc3b5498e49a93"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "AI-Build-Pulse";
    const body = payload.notification?.body || "";
    const link = payload.fcmOptions?.link || payload.data?.link || "https://aibuildpulse.vercel.app/";

    self.registration.showNotification(title, {
        body: body,
        icon: "/logo.png",
        badge: "/logo.png",
        data: { link: link },
    });
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const link = event.notification.data?.link || "/";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && "focus" in client) {
                    if ("navigate" in client) client.navigate(link);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(link);
        })
    );
});