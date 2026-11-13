import fs from 'node:fs/promises';
import path from 'node:path';

const NEWS_FILE = path.join(process.cwd(), 'data', 'news.json');
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

async function main() {
    const data = JSON.parse(await fs.readFile(NEWS_FILE, 'utf8'));
    const articles = data.articles || [];
    if (articles.length === 0) return console.log('No articles.');

    const now = new Date();
    const istHour = new Date(now.getTime() + 5.5 * 3600 * 1000).getHours();

    let index = 0;
    if (istHour === 8) index = 0;
    else if (istHour === 11) index = 1;
    else if (istHour === 14) index = 2;
    else if (istHour === 17) index = 3;
    else if (istHour === 20) index = 4;
    else if (istHour === 23) index = 5;

    const article = articles[index] || articles[0];

    // OneSignal API Payload
    const payload = {
        app_id: ONESIGNAL_APP_ID,
        included_segments: ["Subscribed Users"], // Sends to everyone who allowed notifications
        headings: { en: article.category + " Update" },
        contents: { en: article.title.substring(0, 100) + "..." },
        url: "https://aibuildpulse.vercel.app/article?id=" + article.id
    };

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    console.log('OneSignal Response:', await res.json());
}
main().catch(console.error);