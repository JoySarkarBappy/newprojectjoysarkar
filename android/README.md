# Srot for Android

Srot (স্রোত)-এর Android সংস্করণ: YouTube, Facebook, Instagram, TikTok সহ হাজারো সাইট থেকে ভিডিও, গান আর যেকোনো ফাইল নামানোর অ্যাপ।

Developed by **Joy Sarkar and Dhrubo Das**.

## কী কী পারে

- **Share করে ডাউনলোড:** YouTube বা যেকোনো অ্যাপে ভিডিওর Share চেপে Srot বেছে নিলে quality বাছাইয়ের তালিকা আসে।
- **লিংক paste করে:** Home-এ লিংক বসিয়ে Download। লিংক না দিয়ে শব্দ লিখলে YouTube-এ খোঁজে।
- **ভেতরের browser:** Home থেকে YouTube, Facebook, Instagram, TikTok ইত্যাদি খুলে ভিডিও খুঁজে Download বাটন চাপা যায়। Instagram বা Facebook-এ লগইন করলে সেই লগইন দিয়েই নামায়।
- **Quality বাছাই:** 144p থেকে 4K পর্যন্ত যা আছে, আনুমানিক সাইজসহ। গান হিসেবে MP3 বা M4A।
- **Background-এ ডাউনলোড:** স্ক্রিন বন্ধ থাকলেও চলে, notification-এ progress দেখায়। Pause / resume, একসাথে ১ থেকে ৩টা।
- **Light ও Dark mode:** Home-এর উপরের গোল বাটনে এক চাপে, অথবা Settings থেকে।
- **নিজে নিজে আপডেট:** সাইটগুলো প্রায়ই বদলায়, তাই ভেতরের yt-dlp দিনে একবার নিজে আপডেট হয়।

ফাইলগুলো যায় ফোনের **Download/Srot** ফোল্ডারে, gallery আর music অ্যাপে দেখা যায়।

## কোন APK নেবে

- `Srot-arm64-v8a.apk`: প্রায় সব নতুন ফোন (২০১৭-র পর)। প্রথমে এটাই দাও।
- `Srot-armeabi-v7a.apk`: পুরোনো বা কম দামের ফোন, যেখানে উপরেরটা install হয় না।
- `Srot-universal.apk`: সব ফোনে চলে, তবে সাইজ বড়।

Android 8 বা নতুন লাগে।

## ভেতরে কী আছে

- Kotlin + Jetpack Compose (Material 3)
- [youtubedl-android](https://github.com/yausername/youtubedl-android) 0.18.1: yt-dlp, Python, ffmpeg আর QuickJS (YouTube এখন JavaScript চালাতে বলে)
- কোনো বিজ্ঞাপন, tracking বা লগইন নেই

## Build

GitHub Actions প্রতিবার push-এ unit test চালায়, APK বানায়, তারপর Android 14 emulator-এ অ্যাপ install করে PDF, YouTube ভিডিও, MP3 আর pause/resume পরীক্ষা করে। ফল আর screenshot থাকে Actions-এর `emulator-results`-এ।

নিজে build করতে: JDK 17 আর Android SDK লাগবে, তারপর `./gradlew assembleRelease`।

শুধু সেই জিনিস নামাও যেটা রাখার অধিকার তোমার আছে। DRM দেওয়া ভিডিও (Netflix ইত্যাদি) নামানো যায় না।
