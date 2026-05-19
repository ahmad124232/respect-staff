# Respect Staff

موقع إدارة Respect Staff جاهز للنشر.

## التشغيل المحلي

```bash
npm install
npm start
```

ثم افتح:

```txt
http://localhost:3000
```

## إعدادات مهمة

انسخ `.env.example` إلى `.env` وعبّئ القيم:

```env
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
DISCORD_GUILD_ID=
DISCORD_BOT_TOKEN=
DISCORD_LEAVE_ROLE_ID=
SESSION_SECRET=change-this-secret
```

## ملاحظات قبل النشر

- لا تنشر ملف `.env`.
- تأكد أن رابط Redirect في Discord Developer Portal يطابق `DISCORD_REDIRECT_URI`.
- تأكد أن البوت داخل السيرفر وعنده الصلاحيات المطلوبة.
- بعد تغيير `.env` أعد تشغيل السيرفر.
