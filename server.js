process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');

const app = express();

app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const REQUIRED_ENV = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'DISCORD_GUILD_ID',
  'DISCORD_BOT_TOKEN',
  'SESSION_SECRET'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`[تحذير] المتغير ${key} غير موجود في .env`);
  }
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'CHANGE_ME_NOW',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// أول ما أي شخص يفتح الموقع، يتم تحويله لتسجيل دخول Discord تلقائياً
app.use((req, res, next) => {
  const isHomePage = req.method === 'GET' && (req.path === '/' || req.path === '/index.html');

  if (isHomePage && !req.session.user) {
    return res.redirect('/auth/discord');
  }

  next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const PERMISSIONS = {
  OWNER: ['ALL'],

  DEVELOPER: ['ALL'],

  ADMIN: [
    'MANAGE_RULES',
    'MANAGE_REPORTS',
    'CREATE_NEWS',
    'MANAGE_NEWS',
    'MANAGE_LEAVES',
    'MANAGE_STAFF',
    'VIEW_LOGS'
  ],

  SUPERVISOR: [
    'SUPERVISOR_PANEL',
    'MANAGE_BANS',
    'MANAGE_WARNINGS',
    'VIEW_PLAYER_FILES',
    'MANAGE_STAFF_COMPLAINTS',
    'VIEW_LOGS'
  ],

  SUPPORT: [
    'VIEW_REPORTS',
    'CLAIM_REPORTS',
    'REPLY_REPORTS'
  ],

  PROMOTIONS: [
    'MANAGE_PROMOTIONS',
    'VIEW_LOGS'
  ]
};

// رتب الصلاحيات فقط.
// ملاحظة مهمة: كل رتب Discord تظهر في الموقع للعرض، لكن الصلاحيات لا تأتي إلا من IDs الموجودة هنا في .env.
const PERMISSION_ROLE_MAP = [
  { env: 'OWNER_ROLE_ID', label: 'Owner', group: 'OWNER' },
  { env: 'DEVELOPER_ROLE_ID', label: 'مبرمج الموقع', group: 'DEVELOPER' },
  { env: 'ADMIN_ROLE_ID', label: 'Admin', group: 'ADMIN' },
  { env: 'SUPPORT_ROLE_ID', label: 'Support', group: 'SUPPORT' },
  { env: 'PROMOTION_MANAGER_ROLE_ID', label: 'مسؤول الترقيات', group: 'PROMOTIONS' }
];

let guildRolesCache = {
  fetchedAt: 0,
  rolesById: {}
};

function roleColorToHex(colorNumber) {
  if (!colorNumber || Number(colorNumber) === 0) return null;
  return `#${Number(colorNumber).toString(16).padStart(6, '0')}`;
}

async function getGuildRolesMap() {
  const now = Date.now();

  // تحديث الكاش كل 10 دقائق
  if (guildRolesCache.fetchedAt && now - guildRolesCache.fetchedAt < 10 * 60 * 1000) {
    return guildRolesCache.rolesById;
  }

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    return guildRolesCache.rolesById || {};
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/roles`, {
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
      }
    });

    if (!response.ok) {
      console.error('Discord roles fetch failed:', response.status, await response.text());
      return guildRolesCache.rolesById || {};
    }

    const roles = await response.json();

    const rolesById = {};
    for (const role of roles) {
      rolesById[role.id] = {
        id: role.id,
        name: role.name,
        color: roleColorToHex(role.color),
        position: role.position || 0
      };
    }

    guildRolesCache = {
      fetchedAt: now,
      rolesById
    };

    return rolesById;
  } catch (error) {
    console.error('Guild roles fetch error:', error);
    return guildRolesCache.rolesById || {};
  }
}

function getDisplayRolesFromIds(roleIds = [], rolesById = {}) {
  return roleIds
    .map(roleId => rolesById[roleId])
    .filter(Boolean)
    .filter(role => role.name !== '@everyone')
    .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
    .map(role => ({
      id: role.id,
      name: role.name,
      color: role.color || null,
      position: role.position || 0
    }));
}

function getPermissionsFromRoles(roleIds = [], rolesById = {}) {
  let permissions = [];
  let permissionLabels = [];

  const roleMap = typeof PERMISSION_ROLE_MAP !== 'undefined'
    ? PERMISSION_ROLE_MAP
    : (typeof DISCORD_ROLE_MAP !== 'undefined' ? DISCORD_ROLE_MAP : []);

  for (const role of roleMap) {
    const roleId = process.env[role.env] || (role.fallbackEnv ? process.env[role.fallbackEnv] : '');

    if (roleId && roleIds.includes(roleId)) {
      permissions.push(...(PERMISSIONS[role.group] || []));
      permissionLabels.push(role.label || role.group || role.env);
    }
  }

  permissions = unique(permissions);
  permissionLabels = unique(permissionLabels);

  if (permissions.includes('ALL')) {
    permissions = ['ALL'];
  }

  const displayRoles = typeof getDisplayRolesFromIds === 'function'
    ? getDisplayRolesFromIds(roleIds, rolesById)
    : [];

  const roleLabel = displayRoles.length
    ? displayRoles.map(r => r.name).join(' + ')
    : (permissionLabels.length ? permissionLabels.join(' + ') : 'زائر');

  return {
    permissions,
    labels: permissionLabels,
    permissionLabels,
    displayRoles,
    isAdmin: permissions.length > 0,
    roleLabel,
    permissionLabel: permissionLabels.length ? permissionLabels.join(' + ') : 'بدون صلاحيات'
  };
}

function avatarUrl(user) {
  if (!user || !user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function unique(arr) {
  return [...new Set(arr)];
}


// Duplicate getPermissionsFromRoles removed during final cleanup



function getWebhookStyle(action) {
  action = String(action || '');

  if (action.includes('بلاغ')) {
    return {
      color: 15158332,
      emoji: '🚨',
      title: 'بلاغ جديد',
      mentionEnv: 'DISCORD_ADMIN_MENTION_ROLE_ID'
    };
  }

  if (action.includes('باند')) {
    return {
      color: 10038562,
      emoji: '⛔',
      title: 'إجراء باند',
      mentionEnv: 'DISCORD_SUPERVISOR_MENTION_ROLE_ID'
    };
  }

  if (action.includes('warning')) {
    return {
      color: 16763904,
      emoji: '⚠️',
      title: 'تحذير جديد',
      mentionEnv: 'DISCORD_SUPERVISOR_MENTION_ROLE_ID'
    };
  }

  if (action.includes('شكوى')) {
    return {
      color: 15548997,
      emoji: '📢',
      title: 'شكوى على إداري',
      mentionEnv: 'DISCORD_OWNER_MENTION_ROLE_ID'
    };
  }

  if (action.includes('اقتراح')) return { color: 16776960, emoji: '💡', title: 'اقتراح جديد' };
  if (action.includes('اعتراض')) return { color: 16763904, emoji: '⚖️', title: 'اعتراض على قانون' };
  if (action.includes('إجازة')) return { color: 7506394, emoji: '🗓️', title: 'إجازات الإدارة' };
  if (action.includes('خبر')) return { color: 3447003, emoji: '📰', title: 'أخبار الإدارة' };
  if (action.includes('تحديث')) return { color: 10181046, emoji: '🛠️', title: 'تحديث' };
  if (action.includes('تسجيل دخول')) return { color: 3447003, emoji: '🔐', title: 'تسجيل دخول إدارة' };
  if (action.includes('حذف')) return { color: 10038562, emoji: '🗑️', title: 'حذف' };
  if (action.includes('إضافة')) return { color: 5763719, emoji: '✅', title: 'إضافة' };
  if (action.includes('تصدير')) return { color: 10181046, emoji: '📄', title: 'تصدير مستند رسمي' };

  return { color: 3447003, emoji: '📌', title: 'إشعار إداري' };
}

function getPublicSiteUrl() {
  return process.env.PUBLIC_SITE_URL || `http://localhost:${PORT}`;
}

function extractPlayerIdFromDetails(details) {
  const text = String(details || '');
  const match = text.match(/(?:ID|id|ايدي|آيدي|معرف)\s*:?\s*([0-9]{3,25})/);
  return match ? match[1] : '';
}

function extractEvidenceFromDetails(details) {
  const text = String(details || '');
  const match = text.match(/https?:\/\/[^\s|]+/);
  return match ? match[0] : '';
}

function buildDiscordComponents(details) {
  const siteUrl = getPublicSiteUrl();
  const evidenceUrl = extractEvidenceFromDetails(details);
  const components = [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: 'فتح الموقع',
          url: siteUrl
        }
      ]
    }
  ];

  if (evidenceUrl) {
    components[0].components.push({
      type: 2,
      style: 5,
      label: 'فتح الدليل',
      url: evidenceUrl
    });
  }

  return components;
}

function buildDiscordMention(style) {
  if (!style || !style.mentionEnv) return { content: '', allowed_mentions: { parse: [] } };

  const roleId = process.env[style.mentionEnv];

  if (!roleId) return { content: '', allowed_mentions: { parse: [] } };

  return {
    content: `<@&${roleId}>`,
    allowed_mentions: {
      roles: [roleId],
      parse: []
    }
  };
}

function getExecutorInfo(fallbackUser) {
  return {
    name: String(fallbackUser || 'غير معروف'),
    role: 'غير محدد',
    avatar: ''
  };
}

async function sendDiscordLog(action, user, details, executor = null) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;

  const now = new Date();
  const style = getWebhookStyle(action);
  const mention = buildDiscordMention(style);
  const playerId = extractPlayerIdFromDetails(details);
  const evidenceUrl = extractEvidenceFromDetails(details);
  const siteUrl = getPublicSiteUrl();
  const executorInfo = executor || getExecutorInfo(user);

  const embed = {
    title: `${style.emoji} ${style.title}`,
    color: style.color,
    description: `**${String(details || 'لا توجد تفاصيل').slice(0, 1800)}**`,
    fields: [
      { name: 'نوع العملية', value: String(action || 'غير محدد'), inline: true },
      { name: 'منفذ العملية', value: String(executorInfo.name || user || 'غير معروف'), inline: true },
      { name: 'رتب المنفذ', value: String(executorInfo.role || 'غير محدد').slice(0, 1000), inline: false },
      { name: 'وقت العملية', value: now.toLocaleString('ar-SA'), inline: true },
      { name: 'رابط الموقع', value: siteUrl, inline: false }
    ],
    footer: { text: 'Respect Staff System • Official Logs' },
    timestamp: now.toISOString()
  };

  if (executorInfo.avatar) {
    embed.thumbnail = { url: executorInfo.avatar };
  }

  if (playerId) {
    embed.fields.push({
      name: 'ID اللاعب',
      value: `\`${playerId}\``,
      inline: true
    });
  }

  if (evidenceUrl) {
    embed.fields.push({
      name: 'الدليل',
      value: evidenceUrl,
      inline: false
    });
  }

  const payload = {
    username: 'Respect Staff Logs',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/5968/5968756.png',
    content: mention.content,
    embeds: [embed],
    components: buildDiscordComponents(details),
    allowed_mentions: mention.allowed_mentions
  };

  try {
    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Webhook failed:', response.status, await response.text());
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
}

// ===============================
// High Admin Access helper - fixed
// ===============================
function hasHighAdminAccessFromDiscordRoles(user) {
    if (!user) return false;
    if (user.isAdmin === true) return true;

    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    if (permissions.includes("ALL") || permissions.includes("ADMIN") || permissions.includes("MANAGE_SITE") || permissions.includes("MANAGE_ADMIN_PANEL")) {
        return true;
    }

    const text = [
        user.permissionLabel,
        user.roleLabel,
        user.role,
        user.rank,
        ...(Array.isArray(user.permissionLabels) ? user.permissionLabels : []),
        ...(Array.isArray(user.roles) ? user.roles : []),
        ...(Array.isArray(user.displayRoles) ? user.displayRoles.map(r => `${r.name || ""} ${r.id || ""}`) : [])
    ].filter(Boolean).join(" ").toLowerCase();

    return [
        "مبرمج الموقع",
        "programmer",
        "developer",
        "owner",
        "co-owner",
        "founder",
        "admin",
        "administrator",
        "high management",
        "high manager",
        "executive",
        "console",
        "الإدارة العليا",
        "ادارة عليا",
        "إدارة عليا",
        "اداري عليا",
        "إداري عليا"
    ].some(word => text.includes(String(word).toLowerCase()));
}



app.get('/auth/discord', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    redirect_uri: process.env.DISCORD_REDIRECT_URI || '',
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state
  });

  const redirectUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

  req.session.save((error) => {
    if (error) {
      console.error('Session save error before Discord OAuth:', error);
      return res.redirect('/?login=oauth_session_error');
    }

    res.redirect(redirectUrl);
  });
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.oauthState) {
      console.warn('OAuth state mismatch:', { received: state, expected: req.session.oauthState });
      return res.redirect('/?login=oauth_state_error');
    }

    delete req.session.oauthState;

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID || '',
        client_secret: process.env.DISCORD_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI || ''
      })
    });

    if (!tokenResponse.ok) {
      console.error('Token error:', tokenResponse.status, await tokenResponse.text());
      return res.status(500).send('فشل تسجيل الدخول من Discord.');
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` }
    });

    if (!userResponse.ok) {
      console.error('User error:', userResponse.status, await userResponse.text());
      return res.status(500).send('فشل قراءة بيانات حساب Discord.');
    }

    const discordUser = await userResponse.json();

    const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` }
    });

    if (!memberResponse.ok) {
      req.session.user = {
        id: discordUser.id,
        username: discordUser.global_name || discordUser.username,
        avatar: discordUser.avatar,
        avatarUrl: avatarUrl(discordUser),
        roles: [],
        permissions: [],
        roleLabel: 'خارج السيرفر',
        isAdmin: false
      };
      req.session.adminMode = false;

      return res.redirect('/?login=not_in_guild');
    }

    const member = await memberResponse.json();
    const roleIds = member.roles || [];
    const rolesById = await getGuildRolesMap();
    const auth = getPermissionsFromRoles(roleIds, rolesById);

    req.session.user = {
      id: discordUser.id,
      username: discordUser.global_name || discordUser.username,
      discordUsername: discordUser.username,
      avatar: discordUser.avatar,
      avatarUrl: avatarUrl(discordUser),
      roles: roleIds,
      permissions: auth.permissions,
      permissionLabels: auth.permissionLabels,
      permissionLabel: auth.permissionLabel,
      displayRoles: auth.displayRoles,
      roleLabel: auth.roleLabel,
      isAdmin: auth.isAdmin
    };
    req.session.adminMode = false;

    await sendDiscordLog(
      'تسجيل دخول Discord',
      req.session.user.username,
      auth.isAdmin
        ? `تم تسجيل الدخول. الرتب: ${auth.roleLabel} | الصلاحيات: ${auth.permissionLabel}`
        : `تم تسجيل الدخول بدون صلاحيات إدارية. الرتب المعروضة: ${auth.roleLabel}`
    );

    res.redirect('/?login=success');
  } catch (err) {
    console.error(err);
    res.status(500).send('حدث خطأ أثناء تسجيل الدخول.');
  }
});

app.get('/api/me', (req, res) => {
  const user = req.session.user || null;
  res.json({
    loggedIn: Boolean(user),
    isAdmin: Boolean(user && user.isAdmin),
    adminMode: Boolean(user && user.isAdmin && req.session.adminMode === true),
    user,
    permissions: user ? user.permissions : []
  });
});

app.post('/api/enter-admin', async (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ ok: false, message: 'يجب تسجيل الدخول بالديسكورد أولاً.' });
  }

  if (!user.isAdmin) {
    return res.status(403).json({ ok: false, message: 'ما عندك رتبة إدارية تسمح بدخول لوحة الإدارة.' });
  }

  req.session.adminMode = true;

  await sendDiscordLog(
    'دخول لوحة الإدارة',
    `${user.username} (${user.roleLabel})`,
    'تم تفعيل وضع لوحة الإدارة من الموقع.'
  );

  res.json({ ok: true, adminMode: true });
});

app.post('/api/exit-admin', async (req, res) => {
  const user = req.session.user;
  req.session.adminMode = false;

  if (user) {
    await sendDiscordLog(
      'خروج من لوحة الإدارة',
      `${user.username} (${user.roleLabel || 'زائر'})`,
      'خرج من وضع لوحة الإدارة وبقي مسجل دخول بالديسكورد.'
    );
  }

  res.json({ ok: true, adminMode: false });
});


app.get('/api/discord/members/search', async (req, res) => {
  const user = req.session.user;

  if (!user || !user.isAdmin || req.session.adminMode !== true) {
    return res.status(403).json({ ok: false, message: 'هذه الميزة مخصصة للوحة الإدارة فقط.' });
  }

  const query = String(req.query.q || '').trim();

  if (query.length < 2) {
    return res.json({ ok: true, members: [] });
  }

  if (!process.env.DISCORD_BOT_TOKEN) {
    return res.status(500).json({ ok: false, message: 'DISCORD_BOT_TOKEN غير موجود في ملف .env.' });
  }

  try {
    const url = new URL(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', '10');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Discord member search failed:', response.status, body);
      return res.status(response.status).json({
        ok: false,
        message: 'فشل البحث عن أعضاء الديسكورد. تأكد من Bot Token وتفعيل Server Members Intent وإضافة البوت للسيرفر.'
      });
    }

    const members = await response.json();
    const rolesById = await getGuildRolesMap();

    const results = members.map(member => {
      const discordUser = member.user || {};
      const roleIds = member.roles || [];
      const auth = getPermissionsFromRoles(roleIds, rolesById);
      const displayName = member.nick || discordUser.global_name || discordUser.username || 'عضو غير معروف';
      const avatarHash = member.avatar || discordUser.avatar;
      const avatar = avatarHash
        ? (member.avatar
            ? `https://cdn.discordapp.com/guilds/${process.env.DISCORD_GUILD_ID}/users/${discordUser.id}/avatars/${avatarHash}.png?size=128`
            : `https://cdn.discordapp.com/avatars/${discordUser.id}/${avatarHash}.png?size=128`)
        : null;

      return {
        id: discordUser.id,
        username: discordUser.username,
        displayName,
        avatarUrl: avatar,
        roleLabel: auth.roleLabel,
        permissionLabel: auth.permissionLabel,
        displayRoles: auth.displayRoles,
        roles: roleIds,
        discordUrl: `https://discord.com/users/${discordUser.id}`
      };
    });

    res.json({ ok: true, members: results });
  } catch (error) {
    console.error('Member search error:', error);
    res.status(500).json({ ok: false, message: 'حدث خطأ أثناء البحث عن العضو.' });
  }
});


app.get('/api/discord/roles', async (req, res) => {
  const user = req.session.user;

  if (!user) {
    return res.status(401).json({ ok: false, message: 'يجب تسجيل الدخول بالديسكورد أولاً.' });
  }

  const rolesById = await getGuildRolesMap();
  const roles = Object.values(rolesById)
    .filter(role => role.name !== '@everyone')
    .sort((a, b) => Number(b.position || 0) - Number(a.position || 0));

  res.json({ ok: true, roles });
});


function serverHasPermission(user, permissionName) {
  if (!user || !Array.isArray(user.permissions)) return false;
  return user.permissions.includes('ALL') || user.permissions.includes(permissionName);
}

async function addDiscordRoleToMember(userId, roleId, reason = '') {
  if (!process.env.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN غير موجود في .env');
  }

  if (!process.env.DISCORD_GUILD_ID) {
    throw new Error('DISCORD_GUILD_ID غير موجود في .env');
  }

  if (!roleId) {
    throw new Error('Role ID غير موجود.');
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'X-Audit-Log-Reason': encodeURIComponent(reason || 'Respect Staff role add')
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`فشل إضافة الرتبة من Discord: ${response.status} ${body}`);
  }

  return true;
}

async function removeDiscordRoleFromMember(userId, roleId, reason = '') {
  if (!process.env.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN غير موجود في .env');
  }

  if (!process.env.DISCORD_GUILD_ID) {
    throw new Error('DISCORD_GUILD_ID غير موجود في .env');
  }

  if (!roleId) {
    throw new Error('Role ID غير موجود.');
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'X-Audit-Log-Reason': encodeURIComponent(reason || 'Respect Staff role remove')
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`فشل إزالة الرتبة من Discord: ${response.status} ${body}`);
  }

  return true;
}

app.post('/api/supervision-applications/approve-final', async (req, res) => {
  try {
    const sessionUser = req.session.user;

    if (!sessionUser || req.session.adminMode !== true) {
      return res.status(401).json({ ok: false, message: 'يجب دخول لوحة الإدارة أولاً.' });
    }

    if (!serverHasPermission(sessionUser, 'ALL') && !serverHasPermission(sessionUser, 'MANAGE_STAFF')) {
      return res.status(403).json({ ok: false, message: 'ما عندك صلاحية قبول طلبات الرقابة.' });
    }

    const { userId, applicantName, applicationId, reason } = req.body || {};

    if (!userId) {
      return res.status(400).json({ ok: false, message: 'Discord ID غير موجود في الطلب.' });
    }

    const roleId = process.env.SUPERVISOR_ROLE_ID;

    if (!roleId) {
      return res.status(500).json({ ok: false, message: 'SUPERVISOR_ROLE_ID غير موجود في .env.' });
    }

    await addDiscordRoleToMember(
      String(userId),
      roleId,
      `قبول نهائي لتقديم رقابة بواسطة ${sessionUser.username}`
    );

    await sendDiscordLog(
      'قبول نهائي لتقديم رقابة',
      `${sessionUser.username} (${sessionUser.permissionLabel || sessionUser.roleLabel || 'إدارة'})`,
      `تم قبول طلب الرقابة نهائياً وإضافة رتبة الرقابة للعضو: ${applicantName || userId} | Discord ID: ${userId} | رقم الطلب: ${applicationId || 'غير محدد'} | السبب: ${reason || 'قبول نهائي'}`,
      {
        name: sessionUser.username,
        role: sessionUser.roleLabel || sessionUser.permissionLabel || 'إدارة',
        avatar: sessionUser.avatarUrl || ''
      }
    );

    res.json({ ok: true, message: 'تم قبول الطلب وإضافة رتبة الرقابة تلقائياً.' });
  } catch (error) {
    console.error('Approve supervision application error:', error);
    res.status(500).json({ ok: false, message: error.message || 'حدث خطأ أثناء قبول الطلب.' });
  }
});

app.post('/api/leave-role/add', async (req, res) => {
  try {
    const sessionUser = req.session.user;

    if (!sessionUser || req.session.adminMode !== true) {
      return res.status(401).json({ ok: false, message: 'يجب دخول لوحة الإدارة أولاً.' });
    }

    if (!serverHasPermission(sessionUser, 'ALL') && !serverHasPermission(sessionUser, 'MANAGE_LEAVES')) {
      return res.status(403).json({ ok: false, message: 'ما عندك صلاحية إدارة الإجازات.' });
    }

    const { userId, adminName, leaveId, reason } = req.body || {};
    const leaveRoleId = process.env.LEAVE_ROLE_ID;

    if (!leaveRoleId) {
      return res.status(500).json({ ok: false, message: 'LEAVE_ROLE_ID غير موجود في .env.' });
    }

    if (!userId) {
      return res.status(400).json({ ok: false, message: 'Discord ID غير موجود.' });
    }

    await addDiscordRoleToMember(
      String(userId),
      leaveRoleId,
      `قبول إجازة بواسطة ${sessionUser.username}`
    );

    await sendDiscordLog(
      'إضافة رتبة إجازة',
      `${sessionUser.username} (${sessionUser.permissionLabel || sessionUser.roleLabel || 'إدارة'})`,
      `تم إضافة رتبة الإجازة للعضو: ${adminName || userId} | Discord ID: ${userId} | رقم الإجازة: ${leaveId || 'غير محدد'} | السبب: ${reason || 'قبول إجازة'}`,
      {
        name: sessionUser.username,
        role: sessionUser.roleLabel || sessionUser.permissionLabel || 'إدارة',
        avatar: sessionUser.avatarUrl || ''
      }
    );

    res.json({ ok: true, message: 'تم إضافة رتبة الإجازة.' });
  } catch (error) {
    console.error('Add leave role error:', error);
    res.status(500).json({ ok: false, message: error.message || 'حدث خطأ أثناء إضافة رتبة الإجازة.' });
  }
});

app.post('/api/leave-role/remove', async (req, res) => {
  try {
    const sessionUser = req.session.user;

    if (!sessionUser || req.session.adminMode !== true) {
      return res.status(401).json({ ok: false, message: 'يجب دخول لوحة الإدارة أولاً.' });
    }

    if (!serverHasPermission(sessionUser, 'ALL') && !serverHasPermission(sessionUser, 'MANAGE_LEAVES')) {
      return res.status(403).json({ ok: false, message: 'ما عندك صلاحية إدارة الإجازات.' });
    }

    const { userId, adminName, leaveId, reason } = req.body || {};
    const leaveRoleId = process.env.LEAVE_ROLE_ID;

    if (!leaveRoleId) {
      return res.status(500).json({ ok: false, message: 'LEAVE_ROLE_ID غير موجود في .env.' });
    }

    if (!userId) {
      return res.status(400).json({ ok: false, message: 'Discord ID غير موجود.' });
    }

    await removeDiscordRoleFromMember(
      String(userId),
      leaveRoleId,
      `إنهاء إجازة بواسطة ${sessionUser.username}`
    );

    await sendDiscordLog(
      'إزالة رتبة إجازة',
      `${sessionUser.username} (${sessionUser.permissionLabel || sessionUser.roleLabel || 'إدارة'})`,
      `تم إزالة رتبة الإجازة من العضو: ${adminName || userId} | Discord ID: ${userId} | رقم الإجازة: ${leaveId || 'غير محدد'} | السبب: ${reason || 'انتهاء الإجازة'}`,
      {
        name: sessionUser.username,
        role: sessionUser.roleLabel || sessionUser.permissionLabel || 'إدارة',
        avatar: sessionUser.avatarUrl || ''
      }
    );

    res.json({ ok: true, message: 'تم إزالة رتبة الإجازة.' });
  } catch (error) {
    console.error('Remove leave role error:', error);
    res.status(500).json({ ok: false, message: error.message || 'حدث خطأ أثناء إزالة رتبة الإجازة.' });
  }
});


app.post('/api/log', async (req, res) => {
  const { action, user, details } = req.body || {};
  const sessionUser = req.session.user;

  const safeUser = sessionUser && sessionUser.isAdmin
    ? `${sessionUser.username} (${sessionUser.permissionLabel || sessionUser.roleLabel || 'إدارة'})`
    : (user || 'زائر الموقع');

  const executor = sessionUser ? {
    name: sessionUser.username || safeUser,
    role: sessionUser.roleLabel || sessionUser.permissionLabel || 'زائر',
    avatar: sessionUser.avatarUrl || ''
  } : null;

  await sendDiscordLog(action, safeUser, details, executor);

  res.json({ ok: true });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.get('*', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/auth/discord');
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===============================
// Discord Leave Role API - fixed
// ===============================
const DISCORD_API_BASE_FOR_LEAVE = "https://discord.com/api/v10";

async function discordLeaveApiRequest(method, endpoint) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        throw new Error("DISCORD_BOT_TOKEN is missing in .env");
    }

    const response = await fetch(`${DISCORD_API_BASE_FOR_LEAVE}${endpoint}`, {
        method,
        headers: {
            "Authorization": `Bot ${token}`,
            "Content-Type": "application/json"
        }
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Discord API error ${response.status}: ${text}`);
    }

    return true;
}

function getLeaveRoleSettings() {
    const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;
    const leaveRoleId =
        process.env.DISCORD_LEAVE_ROLE_ID ||
        process.env.LEAVE_ROLE_ID ||
        process.env.ADMIN_LEAVE_ROLE_ID;

    return { guildId, leaveRoleId };
}

app.post("/api/discord/leave-role/add", async (req, res) => {
    try {
        const { userId } = req.body || {};
        const sessionUserId = req.user?.id || req.session?.user?.id || req.session?.passport?.user?.id;
        if (sessionUserId && String(sessionUserId) !== String(userId)) {
            return res.status(403).json({ ok: false, error: "You can only manage your own leave role" });
        }
        const { guildId, leaveRoleId } = getLeaveRoleSettings();

        if (!userId) return res.status(400).json({ ok: false, error: "Missing userId" });
        if (!guildId) return res.status(500).json({ ok: false, error: "Missing DISCORD_GUILD_ID in .env" });
        if (!leaveRoleId) return res.status(500).json({ ok: false, error: "Missing DISCORD_LEAVE_ROLE_ID in .env" });

        await discordLeaveApiRequest(
            "PUT",
            `/guilds/${guildId}/members/${userId}/roles/${leaveRoleId}`
        );

        res.json({ ok: true, message: "Leave role added" });
    } catch (error) {
        console.error("Add leave role error:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post("/api/discord/leave-role/remove", async (req, res) => {
    try {
        const { userId } = req.body || {};
        const sessionUserId = req.user?.id || req.session?.user?.id || req.session?.passport?.user?.id;
        if (sessionUserId && String(sessionUserId) !== String(userId)) {
            return res.status(403).json({ ok: false, error: "You can only manage your own leave role" });
        }
        const { guildId, leaveRoleId } = getLeaveRoleSettings();

        if (!userId) return res.status(400).json({ ok: false, error: "Missing userId" });
        if (!guildId) return res.status(500).json({ ok: false, error: "Missing DISCORD_GUILD_ID in .env" });
        if (!leaveRoleId) return res.status(500).json({ ok: false, error: "Missing DISCORD_LEAVE_ROLE_ID in .env" });

        await discordLeaveApiRequest(
            "DELETE",
            `/guilds/${guildId}/members/${userId}/roles/${leaveRoleId}`
        );

        res.json({ ok: true, message: "Leave role removed" });
    } catch (error) {
        console.error("Remove leave role error:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ===============================
// Current user API - for leave self identity
// ===============================
app.get("/api/current-user", (req, res) => {
    try {
        const user =
            req.user ||
            req.session?.user ||
            req.session?.discordUser ||
            req.session?.passport?.user ||
            req.session?.authUser ||
            null;

        if (!user) {
            return res.json({ loggedIn: false, user: null });
        }

        res.json({
            loggedIn: true,
            user: {
                id: user.id || user.discordId || user.userId || user.discordUserId || "",
                username: user.username || user.discordUsername || user.name || "",
                discordUsername: user.discordUsername || user.username || user.name || "",
                avatar: user.avatar || "",
                avatarUrl: user.avatarUrl || "",
                roles: user.roles || [],
                permissions: user.permissions || [],
                permissionLabel: user.permissionLabel || "",
                roleLabel: user.roleLabel || "",
                isAdmin: !!user.isAdmin || hasHighAdminAccessFromDiscordRoles(user)
            }
        });
    } catch (error) {
        console.error("current-user endpoint error:", error);
        res.status(500).json({ loggedIn: false, error: error.message });
    }
});

// ===============================
// Discord Leave Role Admin Grant API - verified
// يستخدم عند قبول الإدارة للإجازة، ويعطي الرتبة لصاحب الطلب
// ===============================
function isLeaveRoleAdminRequest(req) {
    const user =
        req.user ||
        req.session?.user ||
        req.session?.discordUser ||
        req.session?.passport?.user ||
        req.session?.authUser ||
        null;

    if (!user) return false;

    if (user.isAdmin === true) return true;

    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    if (permissions.includes("ALL") || permissions.includes("MANAGE_LEAVES") || permissions.includes("ADMIN")) return true;

    const roleText = [
        user.permissionLabel,
        user.roleLabel,
        user.role,
        user.username,
        ...(Array.isArray(user.permissionLabels) ? user.permissionLabels : []),
        ...(Array.isArray(user.displayRoles) ? user.displayRoles.map(r => r.name || "") : [])
    ].filter(Boolean).join(" ").toLowerCase();

    return [
        "admin",
        "administrator",
        "owner",
        "co-owner",
        "founder",
        "console",
        "high management",
        "high manager",
        "مبرمج",
        "ادمن",
        "أدمن",
        "مالك",
        "اونر",
        "إدارة",
        "ادارة"
    ].some(word => roleText.includes(word.toLowerCase()));
}

app.post("/api/discord/leave-role/admin-add", async (req, res) => {
    try {
        if (!isLeaveRoleAdminRequest(req)) {
            return res.status(403).json({ ok: false, error: "Only admins can approve leave role" });
        }

        const { userId } = req.body || {};
        const { guildId, leaveRoleId } = getLeaveRoleSettings();

        if (!userId) return res.status(400).json({ ok: false, error: "Missing userId" });
        if (!guildId) return res.status(500).json({ ok: false, error: "Missing DISCORD_GUILD_ID in .env" });
        if (!leaveRoleId) return res.status(500).json({ ok: false, error: "Missing DISCORD_LEAVE_ROLE_ID in .env" });

        await discordLeaveApiRequest(
            "PUT",
            `/guilds/${guildId}/members/${userId}/roles/${leaveRoleId}`
        );

        res.json({ ok: true, message: "Leave role added by admin approval", userId });
    } catch (error) {
        console.error("Admin add leave role error:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post("/api/discord/leave-role/admin-remove", async (req, res) => {
    try {
        if (!isLeaveRoleAdminRequest(req)) {
            return res.status(403).json({ ok: false, error: "Only admins can remove leave role" });
        }

        const { userId } = req.body || {};
        const { guildId, leaveRoleId } = getLeaveRoleSettings();

        if (!userId) return res.status(400).json({ ok: false, error: "Missing userId" });
        if (!guildId) return res.status(500).json({ ok: false, error: "Missing DISCORD_GUILD_ID in .env" });
        if (!leaveRoleId) return res.status(500).json({ ok: false, error: "Missing DISCORD_LEAVE_ROLE_ID in .env" });

        await discordLeaveApiRequest(
            "DELETE",
            `/guilds/${guildId}/members/${userId}/roles/${leaveRoleId}`
        );

        res.json({ ok: true, message: "Leave role removed by admin", userId });
    } catch (error) {
        console.error("Admin remove leave role error:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
});







app.listen(PORT, () => {
  console.log(`Respect Staff Discord project يعمل على http://localhost:${PORT}`);
});
