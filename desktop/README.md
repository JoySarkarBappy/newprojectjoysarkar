# Srot Download Manager

Srot (স্রোত) হলো Mac ও Windows-এর জন্য IDM-ধরনের একটা download manager। একটা ফাইলকে অনেকগুলো connection-এ ভাগ করে নামায়, যেকোনো সময় pause/resume করা যায়, আর browser থেকে ডাউনলোড নিজে ধরে নেয়।

Developed by **Joy Sarkar** and **Dhrubo Das**.

## কী কী পারে

- **দ্রুত ডাউনলোড:** প্রতি ফাইলে ৩২টা পর্যন্ত connection (ডিফল্ট ৮)। কোনো অংশ ধীর হলে দ্রুত connection সেটার অর্ধেক নিয়ে নেয়।
- **Pause / resume:** অ্যাপ বন্ধ হলে, crash করলে বা বিদ্যুৎ গেলেও যেখানে থেমেছিল সেখান থেকে চলে।
- **নিজে থেকে আবার চেষ্টা:** নেট কেটে গেলে অপেক্ষা করে আবার শুরু করে। connection আটকে গেলে ৩০ সেকেন্ড পর বদলে নেয়।
- **Queue:** একসাথে কয়টা ডাউনলোড চলবে ঠিক করা যায়, ক্রম বদলানো যায়।
- **Scheduler:** নির্দিষ্ট সময়ে শুরু করা যায়, অথবা শুধু নির্দিষ্ট ঘণ্টার মধ্যে (যেমন রাত ১১টা থেকে সকাল ৭টা) ডাউনলোড চালানো যায়।
- **Speed limit:** নিচের status bar থেকে এক ক্লিকে চালু বা বন্ধ।
- **লিংকের মেয়াদ শেষ হলে:** নতুন লিংক বসিয়ে আগের progress থেকে চালিয়ে যাওয়া যায় (right-click → Update link)।
- **ভিডিও সাইট:** yt-dlp দিয়ে YouTube সহ অনেক সাইট থেকে ভিডিও বা শুধু audio।
- **Light ও Dark mode:** উপরের ডানদিকের অর্ধেক-ভরা গোল বাটনে এক ক্লিকে বদলায়। Settings → Appearance থেকে Light, Dark অথবা কম্পিউটারের সেটিং অনুযায়ী রাখা যায়।
- **Browser extension:** Chrome ও Edge-এর ডাউনলোড সরাসরি Srot-এ চলে আসে।

## Mac-এ install করা

দরকার: Apple Silicon Mac (M1 বা নতুন), macOS 13 বা নতুন।

1. `Srot-mac-arm64.zip` ডাবল-ক্লিক করে খোলো, `Srot.app` কে **Applications** ফোল্ডারে টেনে নাও।
2. `Srot` ডাবল-ক্লিক করো। অ্যাপটা Apple-এর কাছে notarize করা নয়, তাই প্রথমবার macOS আটকাবে।
3. **System Settings → Privacy & Security** খুলে নিচে স্ক্রল করো, Srot-এর পাশে **Open Anyway** চাপো। এটা শুধু প্রথমবার লাগবে।

যদি macOS বলে অ্যাপটা "damaged", Terminal খুলে এই এক লাইন চালাও, তারপর আবার খোলো:

```bash
xattr -cr /Applications/Srot.app && codesign --force --deep --sign - /Applications/Srot.app
```

প্রথম ডাউনলোডের সময় macOS জিজ্ঞেস করবে Srot কি Downloads ফোল্ডারে লিখতে পারবে। Allow দাও।

## Windows-এ install করা

দরকার: Windows 10 বা 11 (64-bit)।

1. `Srot-windows-x64.zip`-এ right-click করে **Extract All** দাও। ফোল্ডারটা এমন জায়গায় রাখো যেখানে থাকবে, যেমন `C:\Srot`।
2. ফোল্ডারের ভেতরের `Srot.exe` ডাবল-ক্লিক করো।
3. প্রথমবার Windows "Windows protected your PC" দেখাতে পারে, কারণ অ্যাপটা code-signed নয়। **More info → Run anyway** চাপো।
4. Desktop-এ shortcut চাইলে `Srot.exe`-তে right-click → **Send to → Desktop (create shortcut)**।

Windows-এ ডাউনলোড চলার সময় উইন্ডো বন্ধ করতে গেলে অ্যাপ জিজ্ঞেস করবে: minimize করে চালিয়ে যাবে, নাকি বন্ধ করবে। নিচের লেখায় যেখানে ⌘ আছে, Windows-এ সেখানে Ctrl।

## ব্যবহার

- লিংক কপি করে অ্যাপে **⌘V** চাপো, অথবা **Add link** চাপো। একসাথে অনেক লিংক দিলে প্রতি লাইনে একটা।
- সারিতে ডাবল-ক্লিক: চলমান হলে pause, থেমে থাকলে resume, শেষ হলে ফাইল খোলে।
- Right-click করলে বাকি সব: Start now (queue এড়িয়ে), Move up/down, Start later, Update link, Remove।
- একটা সারি select করলে নিচে দেখা যায় ফাইলের কোন কোন অংশ নেমেছে।
- Mac-এ উইন্ডো বন্ধ করলেও ডাউনলোড চলতে থাকে। পুরো বন্ধ করতে **⌘Q**। পরের বার খুললে অসমাপ্ত ডাউনলোড নিজে থেকে চালু হয়।

## Browser extension (Chrome / Edge)

1. Srot-এ **Settings → Browser → Save extension folder…** চেপে একটা জায়গা বেছে নাও।
2. Browser-এ `chrome://extensions` (Edge-এ `edge://extensions`) খোলো, **Developer mode** চালু করো।
3. **Load unpacked** চেপে `Srot Browser Extension` ফোল্ডারটা দেখিয়ে দাও।
4. Srot-এর Settings থেকে **Pairing code** কপি করো। Extension-এর আইকনে ক্লিক করে **Pairing code and options**-এ গিয়ে paste করে **Save and test** চাপো।

এরপর browser-এ কোনো ডাউনলোড শুরু হলে সেটা Srot-এ চলে যাবে। Srot বন্ধ থাকলে browser নিজেই নামাবে। ১ MB-এর ছোট ফাইল browser-এই থাকে (options থেকে বদলানো যায়)। লিংকে right-click করলে **Download link with Srot** পাবে, আর ভিডিওর পেজে extension-এর আইকন থেকে **Download video on this page**।

## ভিডিও ডাউনলোড

**Settings → Video sites** থেকে দুটো helper install করো (একবারই লাগে):

- **yt-dlp** (প্রায় ৩৫ MB): এটা ছাড়া ভিডিও নামবে না।
- **ffmpeg** (প্রায় ৪৫ MB): 1080p বা তার বেশি, আর MP3-এর জন্য লাগে। এটা ছাড়া সাধারণত 720p পর্যন্ত পাওয়া যায়।

তারপর **Add video** চেপে ভিডিওর পেজের লিংক দাও, **Check** চাপলে quality বেছে নিতে পারবে। কোনো সাইট হঠাৎ কাজ না করলে Settings থেকে yt-dlp **Update** করো। শুধু সেই ভিডিও নামাও যেটা নামানোর অনুমতি তোমার আছে।

## যা এতে নেই

- শুধু HTTP ও HTTPS। Torrent, magnet, FTP নেই।
- Proxy সেটিং নেই।
- DRM দেওয়া ভিডিও (Netflix ইত্যাদি) নামানো যায় না।
- কিছু সার্ভার resume সমর্থন করে না। সেখানে একটাই connection চলে, আর pause করলে আবার শুরু থেকে নামে। অ্যাপ এটা আগেই জানিয়ে দেয়।
- Safari ও Firefox-এর extension নেই।

## Source থেকে চালানো

Node.js 20 বা নতুন লাগবে।

```bash
npm install
npm start                    # অ্যাপ চালায়
npm test                     # engine-এর ১০৬টা test
npm run e2e                  # আসল window চালিয়ে UI পরীক্ষা (Linux, xvfb লাগে)
bash scripts/package-mac.sh  # dist/Srot-mac-arm64.zip বানায়
bash scripts/package-win.sh  # dist/Srot-windows-x64.zip বানায়
```

Engine (`src/engine/`) খাঁটি Node, কোনো বাইরের package ছাড়া। `src/main/` হলো Electron-এর main process আর browser extension-এর জন্য local API (শুধু 127.0.0.1-এ, pairing code সহ)। `src/renderer/` হলো window। `extension/` হলো browser extension।

সেটিংস আর ডাউনলোডের তালিকা থাকে Mac-এ `~/Library/Application Support/Srot/`-এ, Windows-এ `%APPDATA%\Srot\`-এ।
