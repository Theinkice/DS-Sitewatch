const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function generateId() {
  return `site_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function floorToMinute(timestamp) {
  const minuteMs = 60_000;
  return Math.floor(timestamp / minuteMs) * minuteMs;
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function verifyPassword(password, correctPassword) {
  return password === correctPassword;
}

function generateToken(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = btoa(JSON.stringify(payload));
  return `${header}.${data}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

async function handleLogin(request, env) {
  try {
    const { password } = await request.json();
    
    if (!password) {
      return errorResponse('密码不能为空', 400);
    }

    const kvAdmin = await env.MONITOR_DATA.get('admin_password');
    const adminPassword = kvAdmin || 'admin123456';

    if (!verifyPassword(password, adminPassword)) {
      return errorResponse('密码错误', 401);
    }

    const token = generateToken({
      admin: true,
      exp: Date.now() + 24 * 60 * 60 * 1000
    });

    return jsonResponse({
      success: true,
      token,
      message: '登录成功'
    });

  } catch (error) {
    return errorResponse('登录失败: ' + error.message, 500);
  }
}

function requireAuth(request) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, error: '未提供认证信息' };
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return { authorized: false, error: '认证信息无效或已过期' };
  }

  return { authorized: true, payload };
}

async function getState(env) {
  try {
    const data = await env.MONITOR_DATA.get('monitor_state', 'json');
    if (!data) {
      return initializeState();
    }
    return data;
  } catch (error) {
    console.error('获取状态失败:', error);
    return initializeState();
  }
}

async function updateState(env, state) {
  state.lastUpdate = Date.now();
  await env.MONITOR_DATA.put('monitor_state', JSON.stringify(state));
}

function initializeState() {
  return {
    sites: [],
    history: {},
    incidents: {},
    config: {
      historyHours: 24,
      retentionHours: 720,
      checkInterval: 10,
      statusChangeDebounceMinutes: 3,
      groups: [{ id: 'default', name: '默认分类', order: 0 }],
      siteName: '大叔巡站',
      siteSubtitle: '大叔日记 · 站点状态监控',
      pageTitle: '网站监控'
    },
    stats: {
      writes: { today: 0, total: 0, lastDate: '' }
    },
    lastUpdate: Date.now()
  };
}

function calculateStats(history) {
  if (!history || history.length === 0) {
    return { uptime: 100, avgResponseTime: 0, checkCount: 0 };
  }
  
  const onlineCount = history.filter(h => h.status === 'online').length;
  const uptime = ((onlineCount / history.length) * 100).toFixed(2);
  
  const responseTimes = history
    .filter(h => h.responseTime && h.responseTime > 0)
    .map(h => h.responseTime);
  
  const avgResponseTime = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;
  
  return {
    uptime: parseFloat(uptime),
    avgResponseTime,
    checkCount: history.length
  };
}

function getLatestIncidents(state, limit = 20) {
  const allIncidents = [];
  
  if (state.incidents) {
    for (const siteId in state.incidents) {
      const siteIncidents = state.incidents[siteId];
      if (Array.isArray(siteIncidents)) {
        allIncidents.push(...siteIncidents);
      }
    }
  }
  
  return allIncidents
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

function sortGroups(groups) {
  return [...(groups || [])]
    .map((group, index) => ({
      ...group,
      order: typeof group.order === 'number' && Number.isFinite(group.order)
        ? group.order
        : index
    }))
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
}

function normalizeOrderInput(value, groups, currentGroupId) {
  const list = Array.isArray(groups) ? [...groups] : [];

  if (value === undefined || value === null || value === '') {
    const sorted = sortGroups(list);
    const lastOrder = sorted.length ? sorted[sorted.length - 1].order : -1;
    return lastOrder + 1;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('排序序号必须为数字');
  }

  return Math.floor(parsed);
}

async function getSitesStatus(env) {
  const state = await getState(env);
  
  if (!state.sites || state.sites.length === 0) {
    return jsonResponse([]);
  }
  
  const publicSites = state.sites.map(site => {
    const base = {
      id: site.id,
      name: site.name,
      status: site.status || 'unknown',
      responseTime: site.responseTime || 0,
      lastCheck: site.lastCheck || 0,
      groupId: site.groupId || 'default',
      showUrl: site.showUrl || false,
      sslCert: site.sslCert || null,
      sslCertLastCheck: site.sslCertLastCheck || 0,
      sortOrder: site.sortOrder || 0,
      createdAt: site.createdAt || 0
    };
    if (site.showUrl) {
      base.url = site.url;
    }
    return base;
  });

  return jsonResponse(publicSites);
}

async function getDashboard(env) {
  const state = await getState(env);
  const sites = Array.isArray(state.sites) ? state.sites : [];

  const publicSites = sites.map(site => {
    const base = {
      id: site.id,
      name: site.name,
      status: site.status || 'unknown',
      responseTime: site.responseTime || 0,
      lastCheck: site.lastCheck || 0,
      groupId: site.groupId || 'default',
      showUrl: site.showUrl || false,
      sslCert: site.sslCert || null,
      sslCertLastCheck: site.sslCertLastCheck || 0,
      sortOrder: site.sortOrder || 0,
      createdAt: site.createdAt || 0
    };
    if (site.showUrl) {
      base.url = site.url;
    }
    return base;
  });

  const groups = sortGroups(state.config?.groups || []);
  const settings = {
    siteName: state.config?.siteName || '大叔巡站',
    siteSubtitle: state.config?.siteSubtitle || '大叔日记 · 站点状态监控',
    pageTitle: state.config?.pageTitle || '网站监控'
  };
  const incidents = getLatestIncidents(state, 20);

  return jsonResponse({ sites: publicSites, groups, settings, incidents });
}

async function getIncidents(env, limit = 20) {
  const state = await getState(env);
  const incidents = getLatestIncidents(state, limit);
  return jsonResponse({ incidents });
}

async function getAllSitesHistory(env, hours) {
  try {
    const state = await getState(env);
    const sites = state.sites || [];
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

    const historyMap = {};
    for (const site of sites) {
      const raw = (state.history && state.history[site.id]) ? state.history[site.id] : [];
      const history = raw
        .filter(record => record && typeof record.timestamp === 'number' && record.timestamp >= cutoffTime)
        .sort((a, b) => b.timestamp - a.timestamp);
      const stats = calculateStats(history);
      historyMap[site.id] = { history, stats };
    }

    return jsonResponse(historyMap);
  } catch (error) {
    return errorResponse('获取历史数据失败: ' + error.message, 500);
  }
}

async function getAllSites(env) {
  const state = await getState(env);
  const sites = state.sites || [];
  
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const sitesWithStats = await Promise.all(
    sites.map(async (site) => {
      const raw = (state.history && state.history[site.id]) ? state.history[site.id] : [];
      const history = raw
        .filter(record => record && typeof record.timestamp === 'number' && record.timestamp >= cutoff)
        .sort((a, b) => b.timestamp - a.timestamp);
      const stats = calculateStats(history);
      return {
        ...site,
        showUrl: site.showUrl || false,
        stats
      };
    })
  );

  return jsonResponse(sitesWithStats);
}

async function addSite(request, env) {
  try {
    const data = await request.json();
    const { name, url, groupId, showUrl, method, headers, body, expectedCodes, responseKeyword, responseForbiddenKeyword } = data;

    if (!name || !url) {
      return errorResponse('站点名称和 URL 不能为空');
    }

    if (!isValidUrl(url)) {
      return errorResponse('URL 格式不正确');
    }

    const state = await getState(env);

    if (state.sites.some(s => s.url === url)) {
      return errorResponse('该 URL 已存在');
    }

    const targetGroupId = groupId || 'default';
    if (!state.config.groups.some(g => g.id === targetGroupId)) {
      return errorResponse('指定的分类不存在');
    }

    const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : 'GET';
    const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    const finalMethod = allowedMethods.includes(normalizedMethod) ? normalizedMethod : 'GET';

    let normalizedHeaders = undefined;
    if (headers) {
      if (typeof headers === 'string') {
        let obj = undefined;
        try {
          if (headers.trim().startsWith('{')) obj = JSON.parse(headers);
        } catch {}
        if (!obj) {
          obj = {};
          headers.split(/\r?\n/).forEach(line => {
            const idx = line.indexOf(':');
            if (idx > -1) {
              const k = line.slice(0, idx).trim();
              const v = line.slice(idx + 1).trim();
              if (k) obj[k] = v;
            }
          });
        }
        normalizedHeaders = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
      } else if (typeof headers === 'object') {
        normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)]));
      }
    }

    let normalizedExpectedCodes = undefined;
    if (Array.isArray(expectedCodes)) {
      const codes = expectedCodes.map(n => Number(n)).filter(c => Number.isFinite(c) && c > 0);
      normalizedExpectedCodes = codes.length > 0 ? codes : undefined;
    } else if (typeof expectedCodes === 'string' && expectedCodes.trim()) {
      const codes = expectedCodes.split(',').map(s => Number(s.trim())).filter(c => Number.isFinite(c) && c > 0);
      normalizedExpectedCodes = codes.length > 0 ? codes : undefined;
    }

    const groupSites = state.sites.filter(s => s.groupId === targetGroupId);
    const maxSortOrder = groupSites.reduce((max, s) => Math.max(max, s.sortOrder || 0), -1);

    const newSite = {
      id: generateId(),
      name,
      url,
      groupId: targetGroupId,
      sortOrder: maxSortOrder + 1,
      showUrl: showUrl || false,
      method: finalMethod,
      headers: normalizedHeaders,
      body: typeof body === 'string' ? body : undefined,
      expectedCodes: normalizedExpectedCodes,
      responseKeyword: typeof responseKeyword === 'string' ? responseKeyword : undefined,
      responseForbiddenKeyword: typeof responseForbiddenKeyword === 'string' ? responseForbiddenKeyword : undefined,
      status: 'unknown',
      statusRaw: 'unknown',
      statusPending: null,
      statusPendingCount: 0,
      responseTime: 0,
      lastCheck: 0,
      createdAt: Date.now()
    };

    state.sites.push(newSite);
    await updateState(env, state);

    try {
      await triggerCheck(env);
    } catch (e) {
      console.error('添加站点后触发检测失败:', e && e.message ? e.message : e);
    }

    return jsonResponse({
      success: true,
      site: newSite,
      message: '站点添加成功，将在下次检测时获取状态'
    });

  } catch (error) {
    return errorResponse('添加站点失败: ' + error.message, 500);
  }
}

async function updateSite(request, env, siteId) {
  try {
    const data = await request.json();
    const state = await getState(env);
    
    const siteIndex = state.sites.findIndex(s => s.id === siteId);

    if (siteIndex === -1) {
      return errorResponse('站点不存在', 404);
    }

    const next = { ...state.sites[siteIndex], ...data };
    if (typeof next.method === 'string') {
      const m = next.method.toUpperCase();
      const allowed = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
      next.method = allowed.includes(m) ? m : 'GET';
    }
    if (next.headers) {
      let h = next.headers;
      if (typeof h === 'string') {
        let obj = undefined;
        try {
          if (h.trim().startsWith('{')) obj = JSON.parse(h);
        } catch {}
        if (!obj) {
          obj = {};
          h.split(/\r?\n/).forEach(line => {
            const idx = line.indexOf(':');
            if (idx > -1) {
              const k = line.slice(0, idx).trim();
              const v = line.slice(idx + 1).trim();
              if (k) obj[k] = v;
            }
          });
        }
        h = obj;
      }
      if (h && typeof h === 'object') {
        next.headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, String(v)]));
      } else {
        next.headers = undefined;
      }
    }
    if (next.expectedCodes !== undefined) {
      let codes = next.expectedCodes;
      if (typeof codes === 'string') {
        if (codes.trim()) {
          codes = codes.split(',').map(s => Number(s.trim())).filter(c => Number.isFinite(c) && c > 0);
        } else {
          codes = [];
        }
      }
      if (Array.isArray(codes)) {
        const filtered = codes.map(n => Number(n)).filter(c => Number.isFinite(c) && c > 0);
        next.expectedCodes = filtered.length > 0 ? filtered : undefined;
      } else {
        next.expectedCodes = undefined;
      }
    }
    if (typeof next.body !== 'string') {
      next.body = undefined;
    }
    state.sites[siteIndex] = {
      ...next,
      id: siteId,
      updatedAt: Date.now()
    };

    await updateState(env, state);

    return jsonResponse({
      success: true,
      site: state.sites[siteIndex],
      message: '站点更新成功'
    });

  } catch (error) {
    return errorResponse('更新站点失败: ' + error.message, 500);
  }
}

async function deleteSite(env, siteId) {
  try {
    const state = await getState(env);
    
    const filteredSites = state.sites.filter(s => s.id !== siteId);

    if (filteredSites.length === state.sites.length) {
      return errorResponse('站点不存在', 404);
    }

    state.sites = filteredSites;
    delete state.history[siteId];
    delete state.incidents[siteId];
    
    await updateState(env, state);

    return jsonResponse({
      success: true,
      message: '站点已删除'
    });
  } catch (error) {
    return errorResponse('删除站点失败: ' + error.message, 500);
  }
}

async function getSettings(env) {
  try {
    const state = await getState(env);
    return jsonResponse(state.config);
  } catch (error) {
    return errorResponse('获取设置失败: ' + error.message, 500);
  }
}

async function updateSettings(request, env) {
  try {
    const newConfig = await request.json();
    
    if (newConfig.historyHours && (newConfig.historyHours < 1 || newConfig.historyHours > 168)) {
      return errorResponse('历史数据时间范围必须在 1-168 小时之间', 400);
    }
    
    if (newConfig.retentionHours && (newConfig.retentionHours < 24 || newConfig.retentionHours > 720)) {
      return errorResponse('数据保留时间必须在 24-720 小时之间', 400);
    }
    
    if (newConfig.checkInterval && (newConfig.checkInterval < 1 || newConfig.checkInterval > 60)) {
      return errorResponse('强制写入间隔必须在 1-60 分钟之间', 400);
    }
    
    if (newConfig.statusChangeDebounceMinutes !== undefined) {
      const minutes = Number(newConfig.statusChangeDebounceMinutes);
      if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 30) {
        return errorResponse('防抖时间必须在 0.5-30 分钟之间', 400);
      }
    }
    
    const state = await getState(env);
    state.config = {
      ...state.config,
      ...newConfig
    };

    try {
      const interval = Number(state.config.checkInterval);
      if (Number.isFinite(interval) && interval > 0) {
        const now = Date.now();
        const intervalMs = interval * 60 * 1000;
        const lastUpdate = Number(state.lastUpdate);

        if (Number.isFinite(lastUpdate) && lastUpdate > 0) {
          const elapsed = now - lastUpdate;
          if (elapsed >= intervalMs) {
            state.monitorNextDueAt = floorToMinute(now);
          } else {
            const target = lastUpdate + intervalMs;
            state.monitorNextDueAt = floorToMinute(target);
          }
        } else {
          state.monitorNextDueAt = floorToMinute(now + intervalMs);
        }
      }
    } catch (error) {
      console.warn('更新监控写入计划失败:', error);
    }
    
    await updateState(env, state);
    
    return jsonResponse({
      success: true,
      message: '设置已更新',
      config: state.config
    });
  } catch (error) {
    return errorResponse('更新设置失败: ' + error.message, 500);
  }
}

async function getStats(env) {
  try {
    const state = await getState(env);
    const estimatedDailyWrites = Math.round(1440 / state.config.checkInterval);
    
    return jsonResponse({
      ...state.stats,
      estimated: {
        dailyWrites: estimatedDailyWrites,
        quotaUsage: ((state.stats.writes.today / 1000) * 100).toFixed(1)
      }
    });
  } catch (error) {
    return errorResponse('获取统计失败: ' + error.message, 500);
  }
}

async function checkSite(site, checkTime) {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const method = (site.method || 'GET').toString().toUpperCase();
    const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    const finalMethod = allowedMethods.includes(method) ? method : 'GET';

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(site.headers && typeof site.headers === 'object' ? site.headers : {})
    };

    const body = finalMethod === 'GET' || finalMethod === 'HEAD' ? undefined : site.body;

    const response = await fetch(site.url, {
      method: finalMethod,
      signal: controller.signal,
      headers,
      body
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    let isUp;
    const expected = Array.isArray(site.expectedCodes) ? site.expectedCodes : null;
    if (expected && expected.length > 0) {
      isUp = expected.includes(response.status);
    } else {
      isUp = response.ok;
    }

    let message = isUp ? 'OK' : `HTTP ${response.status}`;

    const needKeywordCheck = site.responseKeyword || site.responseForbiddenKeyword;
    if (needKeywordCheck && finalMethod !== 'HEAD') {
      try {
        const text = await response.text();
        if (site.responseKeyword && !text.includes(site.responseKeyword)) {
          isUp = false;
          message = `缺少关键字: ${site.responseKeyword}`;
        }
        if (site.responseForbiddenKeyword && text.includes(site.responseForbiddenKeyword)) {
          isUp = false;
          message = `包含禁用关键字: ${site.responseForbiddenKeyword}`;
        }
      } catch (e) {}
    }

    let finalStatus = isUp ? 'online' : 'offline';
    if (isUp && responseTime > 5000) {
      finalStatus = 'slow';
      message = '响应缓慢';
    }

    return {
      timestamp: checkTime,
      status: finalStatus,
      statusCode: response.status,
      responseTime,
      message
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    let message = '网络错误';
    const errMsg = error?.message?.toLowerCase() || '';
    if (errMsg.includes('timeout') || errMsg.includes('aborted')) {
      message = '连接超时';
    } else if (errMsg.includes('certificate') || errMsg.includes('ssl') || errMsg.includes('tls')) {
      message = '证书错误';
    } else if (errMsg.includes('refused')) {
      message = '连接被拒绝';
    } else if (errMsg.includes('dns') || errMsg.includes('resolve')) {
      message = '域名解析失败';
    }

    return {
      timestamp: checkTime,
      status: 'offline',
      statusCode: 0,
      responseTime,
      message
    };
  }
}

// 判断错误信息是否属于证书类错误（区分证书无效与网络异常）
function isCertificateError(errMsg) {
  const msg = String(errMsg || '').toLowerCase();
  return msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls') || msg.includes('handshake');
}

// 本地证书检测：由 Workers 直接探测目标站点 HTTPS。
// Workers 的 fetch 会严格校验 TLS 证书：
//   - 请求成功 → 证书有效（但拿不到到期时间等详情，置 null）
//   - 抛错且含 certificate/ssl/tls/handshake 关键词 → 证书无效
//   - 超时/DNS 失败/连接被拒等非证书错误 → 无法判定，不写入结果（调用方保留旧值）
async function localCheckSSLCertificates(sites) {
  const certMap = {};

  const httpsSites = Array.isArray(sites)
    ? sites.filter(site => site && site.url && site.url.trim().toLowerCase().startsWith('https://'))
    : [];
  if (httpsSites.length === 0) {
    return certMap;
  }

  const checkOne = async (site) => {
    let domain;
    try {
      domain = new URL(site.url).hostname;
    } catch {
      return;
    }
    if (!domain) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(site.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      // fetch 成功即代表 TLS 握手通过，证书有效
      certMap[domain] = {
        valid: true,
        daysLeft: null,
        issuer: null,
        validFrom: null,
        validTo: null,
        algorithm: null
      };
    } catch (error) {
      const errMsg = error && error.message ? error.message : String(error);
      if (isCertificateError(errMsg)) {
        certMap[domain] = {
          valid: false,
          daysLeft: null,
          issuer: null,
          validFrom: null,
          validTo: null,
          algorithm: null
        };
      }
      // 非证书类错误（超时/DNS/拒绝连接等）不写入映射，保留站点原有证书数据
    } finally {
      clearTimeout(timeoutId);
    }
  };

  await Promise.all(httpsSites.map(checkOne));
  return certMap;
}


function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}天${hours % 24}小时${minutes % 60}分钟`;
  } else if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
}

function stateSiteName(cfg) {
  return (cfg && cfg.siteName) || '大叔巡站';
}

async function sendWeComNotification(webhook, incident, site) {
  if (!webhook) return;
  
  let title, emoji, color;
  if (incident.type === 'recovered') {
    title = '站点恢复通知';
    emoji = '🟩';
    color = 'info'; 
  } else if (incident.type === 'cert_warning') {
    title = '证书到期提醒';
    emoji = '🟧';
    color = 'warning'; 
  } else {
    title = '站点异常通知';
    emoji = '🟥';
    color = 'warning'; 
  }
  
  const lines = [
    `${emoji}<font color="${color}">${title}</font>`,
    ``,
    `> **站点**：${site.name}`,
    `> **详情**：${incident.message}`
  ];
  
  if (incident.type === 'recovered') {
    if (incident.downDuration) {
      const duration = formatDuration(incident.downDuration);
      lines.push(`> **异常时长**：${duration}`);
    }
    if (incident.responseTime) {
      lines.push(`> **当前响应**：${incident.responseTime}ms`);
    }
    if (typeof incident.monthlyDownCount === 'number') {
      lines.push(`> **本月异常**：${incident.monthlyDownCount}次`);
    }
  } else if (incident.type === 'down') {
    if (incident.responseTime) {
      lines.push(`> **响应时间**：${incident.responseTime}ms`);
    }
  } else if (incident.type === 'cert_warning') {
    const daysLeft = incident.daysLeft ?? 0;
    if (incident.certIssuer) {
      lines.push(`> **证书颁发者**：${incident.certIssuer}`);
    }
    if (incident.certValidTo) {
      const validToDate = new Date(incident.certValidTo);
      const dateStr = validToDate.toLocaleString('zh-CN', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Shanghai'  
      });
      lines.push(`> **到期时间**：${dateStr}`);
    }
    if (daysLeft > 0) {
      let nextAlert;
      if (daysLeft > 30) {
        nextAlert = `${daysLeft - 30}天后`;
      } else if (daysLeft > 7) {
        nextAlert = `${daysLeft - 7}天后`;
      } else if (daysLeft > 1) {
        nextAlert = `${daysLeft - 1}天后`;
      } else {
        nextAlert = '已是最后提醒';
      }
      lines.push(`> **下次提醒**：${nextAlert}`);
    }
  }
  
  const notifyTime = new Date(incident.createdAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai' 
  });
  lines.push(`> **通知时间**：${notifyTime}`);
  
  const content = lines.join('\n');
  
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
  });
}

async function sendEmailNotification(env, cfg, incident, site) {
  const emailCfg = cfg?.channels?.email || {};
  if (!emailCfg.enabled || !emailCfg.to) return;
  

  const resendApiKey = emailCfg.resendApiKey;
  if (!resendApiKey) {
    console.warn('邮件通知已启用但未配置 Resend API Key');
    return;
  }
  
  const fromEmail = emailCfg.from && emailCfg.from.includes('@') ? emailCfg.from : 'onboarding@resend.dev';
  const siteName = stateSiteName(cfg);

  let prefix, headerBg, headerIcon, headerTitle, siteTitle, message, boxBg, boxBorder, labelColor;
  const dataRows = [];
  
  const notifyTime = new Date(incident.createdAt).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });

  if (incident.type === 'down') {
    prefix = '异常了';
    headerBg = '#fb7185';
    headerIcon = '😵';
    headerTitle = '哎呀，出问题了！';
    siteTitle = `${site.name} 挂掉了`;
    message = `看起来你的网站刚刚由于 <b>${incident.message || '未知错误'}</b> 倒下了。<br>希望能尽快修复它！`;
    boxBg = '#fffbeb';
    boxBorder = '#d97706';
    labelColor = '#b45309';
    dataRows.push(['⏰ 通知时间', notifyTime]);
    if (incident.responseTime) {
      dataRows.push(['🐢 响应时间', `${incident.responseTime}ms`]);
    }
    dataRows.push(['🔍 错误详情', incident.message || '服务异常']);
  } else if (incident.type === 'recovered') {
    prefix = '恢复了';
    headerBg = '#4ade80';
    headerIcon = '🎉';
    headerTitle = '好耶，复活了！';
    siteTitle = `${site.name} 恢复正常`;
    message = '经过一番折腾，你的网站终于重新上线了！<br>一切看起来都很完美';
    boxBg = '#f0fdf4';
    boxBorder = '#16a34a';
    labelColor = '#15803d';
    if (incident.downDuration) {
      dataRows.push(['⏱️ 异常时长', formatDuration(incident.downDuration)]);
    }
    if (incident.responseTime) {
      dataRows.push(['⚡ 当前响应', `${incident.responseTime}ms`]);
    }
    if (typeof incident.monthlyDownCount === 'number') {
      dataRows.push(['📉 本月异常', `${incident.monthlyDownCount}次`]);
    }
    dataRows.push(['⏰ 恢复时间', notifyTime]);
  } else if (incident.type === 'cert_warning') {
    prefix = '证书快到期';
    headerBg = '#fbbf24';
    headerIcon = '📜';
    headerTitle = '证书快过期啦！';
    siteTitle = site.name;
    const daysLeft = incident.daysLeft ?? 0;
    message = `你的 SSL 证书即将在 <b>${daysLeft}天</b> 后过期。<br>别忘了及时续费哦，不然会有大红锁！`;
    boxBg = '#fff7ed';
    boxBorder = '#ea580c';
    labelColor = '#c2410c';
    if (incident.certIssuer) {
      dataRows.push(['🏢 颁发者', incident.certIssuer]);
    }
    if (incident.certValidTo) {
      const validToDate = new Date(incident.certValidTo);
      const dateStr = validToDate.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Shanghai'
      });
      dataRows.push(['📅 到期时间', dateStr]);
    }
    dataRows.push(['⏳ 剩余天数', `${daysLeft}天`]);
    let nextAlert = '已是最后提醒';
    if (daysLeft > 30) nextAlert = `${daysLeft - 30}天后`;
    else if (daysLeft > 7) nextAlert = `${daysLeft - 7}天后`;
    else if (daysLeft > 1) nextAlert = `${daysLeft - 1}天后`;
    dataRows.push(['🔔 下次提醒', nextAlert]);
  } else {
    return;
  }

  const subject = `大叔巡站 - ${site.name} ${prefix}`;
  

  let dataRowsHtml = '';
  dataRows.forEach((row, i) => {
    const borderBottom = i < dataRows.length - 1 ? 'border-bottom: 1px dashed #e5e7eb;' : '';
    dataRowsHtml += `
      <tr>
        <td style="padding: 10px 0; ${borderBottom} font-weight: bold; color: ${labelColor}; font-size: 14px; white-space: nowrap;">${row[0]}</td>
        <td style="padding: 10px 0; ${borderBottom} font-family: Consolas, monospace; color: #000; font-weight: bold; font-size: 14px; text-align: right;">${row[1]}</td>
      </tr>
    `;
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background: #f0f2f5; font-family: 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 500px; margin: 0 auto;">
        <tr>
            <td>
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #ffffff; border-radius: 20px; border: 3px solid #000; box-shadow: 8px 8px 0 #000; overflow: hidden;">
                    <tr>
                        <td style="background: ${headerBg}; padding: 25px; text-align: center; border-bottom: 3px solid #000;">
                            <div style="font-size: 48px; line-height: 1.2;">${headerIcon}</div>
                            <h1 style="font-size: 22px; margin: 12px 0 0 0; color: #000; font-weight: 900;">${headerTitle}</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 25px; text-align: center;">
                            <h2 style="font-size: 20px; font-weight: bold; margin: 0 0 15px; color: #000;">${siteTitle}</h2>
                            <p style="font-size: 15px; line-height: 1.6; margin: 0 0 25px; color: #4b5563;">${message}</p>
                            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${boxBg}; border: 2px dashed ${boxBorder}; border-radius: 12px;">
                                <tr>
                                    <td style="padding: 15px 20px;">
                                        <table cellpadding="0" cellspacing="0" border="0" width="100%">
                                            ${dataRowsHtml}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 3px solid #000;">
                            <p style="margin: 4px 0;">此邮件由 <b>${siteName}</b> 自动发送</p>
                            <p style="margin: 4px 0;">请勿直接回复本邮件</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendApiKey}`
    },
    body: JSON.stringify({
      from: fromEmail,
      to: emailCfg.to,
      subject,
      html
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Resend 邮件发送失败:', response.status, errorText);
  }
}

function shouldNotifyEvent(cfg, type) {
  if (!cfg || cfg.enabled !== true) return false;
  if (Array.isArray(cfg.events)) return cfg.events.includes(type);
  return true;
}

async function sendNotifications(env, incident, site, cfg) {
  if (!shouldNotifyEvent(cfg, incident.type)) return;
  const promises = [];
  if (cfg?.channels?.wecom?.enabled && cfg.channels.wecom.webhook) {
    promises.push(sendWeComNotification(cfg.channels.wecom.webhook, incident, site));
  }
  if (cfg?.channels?.email?.enabled && cfg.channels.email.to) {
    promises.push(sendEmailNotification(env, cfg, incident, site));
  }
  if (promises.length) {
    await Promise.allSettled(promises);
  }
}


async function updateSslCertificates(env, state) {
  try {
    const sites = Array.isArray(state.sites) ? state.sites : [];
    if (sites.length === 0) return;

    // 只对 https:// 站点做证书检测（http 站点没有证书概念，跳过且不动其数据）
    const httpsSites = sites.filter(site => site && site.url && site.url.trim().toLowerCase().startsWith('https://'));
    if (httpsSites.length === 0) return;

    const certResults = await localCheckSSLCertificates(httpsSites);
    if (!certResults || typeof certResults !== 'object') return;

    const now = Date.now();

    for (const site of httpsSites) {
      let domain;
      try {
        domain = new URL(site.url).hostname;
      } catch {
        continue;
      }

      if (certResults[domain]) {
        // 只有拿到明确结果时才覆盖证书数据
        site.sslCert = certResults[domain];
        site.sslCertLastCheck = now;
      } else {
        // 检测失败/无法判定时保留原有证书数据，只更新检测时间（避免误标"证书无效"）
        site.sslCertLastCheck = now;
      }
    }
  } catch (error) {
    console.error('更新证书信息失败:', error && error.message ? error.message : error);
  }
}

async function triggerCheck(env) {
  try {
    const state = await getState(env);
    
    if (!state.sites || state.sites.length === 0) {
      return jsonResponse({
        success: true,
        message: '没有站点需要检测'
      });
    }

    const now = Date.now();
    const checkPromises = state.sites.map(site => checkSite(site, now));
    const results = await Promise.all(checkPromises);

    let onlineCount = 0;
    for (let i = 0; i < state.sites.length; i++) {
      const site = state.sites[i];
      const result = results[i];

      site.status = result.status;
      site.responseTime = result.responseTime;
      site.lastCheck = now;

      if (!state.history[site.id]) {
        state.history[site.id] = [];
      }
      state.history[site.id].push({
        timestamp: result.timestamp,
        status: result.status,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
        message: result.message
      });

      if (result.status === 'online') {
        onlineCount++;
      }
    }

    if (!state.stats) state.stats = { writes: { today: 0, total: 0 }, checks: { today: 0, total: 0 }, sites: {} };
    state.stats.checks = state.stats.checks || { today: 0, total: 0 };
    state.stats.checks.total++;
    state.stats.checks.today++;
    state.stats.sites = state.stats.sites || {};
    state.stats.sites.total = state.sites.length;
    state.stats.sites.online = onlineCount;
    state.stats.sites.offline = state.sites.length - onlineCount;


    await updateSslCertificates(env, state);

    await updateState(env, state);
    
    return jsonResponse({
      success: true,
      message: `检测完成，已检查 ${state.sites.length} 个站点`,
      results: state.sites.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        responseTime: s.responseTime
      }))
    });
  } catch (error) {
    return errorResponse('触发检查失败: ' + error.message, 500);
  }
}

async function getGroups(env) {
  try {
    const state = await getState(env);
    const groups = sortGroups(state.config.groups || []);
    return jsonResponse({ groups });
  } catch (error) {
    return errorResponse('获取分类失败: ' + error.message, 500);
  }
}

async function addGroup(request, env) {
  try {
    const data = await request.json();
    const { name, order, icon, iconColor } = data;

    if (!name || !name.trim()) {
      return errorResponse('分类名称不能为空');
    }

    const state = await getState(env);

    if (state.config.groups.some(g => g.name === name)) {
      return errorResponse('分类名称已存在');
    }

    const normalizedOrder = normalizeOrderInput(order, state.config.groups);

    const newGroup = {
      id: `group_${Date.now()}`,
      name: name.trim(),
      order: normalizedOrder,
      icon: icon ? icon.trim() : null,
      iconColor: iconColor ? iconColor.trim() : null,
      createdAt: Date.now()
    };

    state.config.groups.push(newGroup);
    state.config.groups = sortGroups(state.config.groups);
    await updateState(env, state);

    return jsonResponse({
      success: true,
      group: newGroup,
      message: '分类添加成功'
    });
  } catch (error) {
    return errorResponse('添加分类失败: ' + error.message, 500);
  }
}

async function updateGroup(request, env, groupId) {
  try {
    const data = await request.json();
    const { name, order, icon, iconColor } = data;

    if (!name || !name.trim()) {
      return errorResponse('分类名称不能为空');
    }

    const state = await getState(env);
    const groupIndex = state.config.groups.findIndex(g => g.id === groupId);

    if (groupIndex === -1) {
      return errorResponse('分类不存在');
    }

    if (state.config.groups.some(g => g.id !== groupId && g.name === name)) {
      return errorResponse('分类名称已存在');
    }

    state.config.groups[groupIndex].name = name.trim();

    if (icon !== undefined) {
      state.config.groups[groupIndex].icon = icon ? icon.trim() : null;
    }

    if (iconColor !== undefined) {
      state.config.groups[groupIndex].iconColor = iconColor ? iconColor.trim() : null;
    }

    if (order !== undefined) {
      const normalizedOrder = normalizeOrderInput(order, state.config.groups, groupId);
      state.config.groups[groupIndex].order = normalizedOrder;
    }

    state.config.groups = sortGroups(state.config.groups);
    await updateState(env, state);

    return jsonResponse({
      success: true,
      group: state.config.groups[groupIndex],
      message: '分类更新成功'
    });
  } catch (error) {
    return errorResponse('更新分类失败: ' + error.message, 500);
  }
}

async function deleteGroup(env, groupId) {
  try {
    const state = await getState(env);

    if (groupId === 'default') {
      return errorResponse('不能删除默认分类');
    }

    const groupIndex = state.config.groups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) {
      return errorResponse('分类不存在');
    }

    const sitesInGroup = state.sites.filter(s => s.groupId === groupId);
    if (sitesInGroup.length > 0) {
      state.sites.forEach(site => {
        if (site.groupId === groupId) {
          site.groupId = 'default';
        }
      });
    }

    state.config.groups.splice(groupIndex, 1);
    await updateState(env, state);

    return jsonResponse({
      success: true,
      message: `分类已删除，${sitesInGroup.length} 个站点已移至默认分类`
    });
  } catch (error) {
    return errorResponse('删除分类失败: ' + error.message, 500);
  }
}

async function reorderSites(request, env) {
  try {
    const { siteIds } = await request.json();
    
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return errorResponse('无效的站点ID列表');
    }

    const state = await getState(env);
    
    siteIds.forEach((id, index) => {
      const site = state.sites.find(s => s.id === id);
      if (site) {
        site.sortOrder = index;
      }
    });

    await updateState(env, state);

    return jsonResponse({
      success: true,
      message: '站点排序已更新'
    });
  } catch (error) {
    return errorResponse('更新排序失败: ' + error.message, 500);
  }
}

async function testNotification(request, env) {
  try {
    const { type, siteId } = await request.json();
    
    if (!type || !['down', 'recovered', 'cert_warning'].includes(type)) {
      return errorResponse('无效的通知类型', 400);
    }
    
    const state = await getState(env);
    
    if (!state.config?.notifications?.enabled) {
      return errorResponse('通知功能未启用', 400);
    }
    
    let site;
    if (siteId) {
      site = state.sites.find(s => s.id === siteId);
      if (!site) {
        return errorResponse('站点不存在', 404);
      }
    } else {
      if (!state.sites || state.sites.length === 0) {
        return errorResponse('没有可用的站点', 400);
      }
      site = state.sites[Math.floor(Math.random() * state.sites.length)];
    }
    


    const sslCert = site.sslCert || {};
    const realDaysLeft = typeof sslCert.daysLeft === 'number' ? sslCert.daysLeft : 7;
    const realCertIssuer = sslCert.issuer || 'Let\'s Encrypt';
    const realCertValidTo = sslCert.validTo || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const incident = {
      id: 'test-' + Date.now(),
      siteId: site.id,
      type,
      createdAt: Date.now(),
      message: type === 'down' 
        ? '【测试】站点无法访问' 
        : type === 'recovered' 
        ? '【测试】站点已恢复正常' 
        : '【测试】证书即将到期',
      responseTime: type === 'down' ? 5000 : 200,
      downDuration: type === 'recovered' ? 300000 : undefined,
      monthlyDownCount: type === 'recovered' ? 3 : undefined,
      daysLeft: type === 'cert_warning' ? realDaysLeft : undefined,
      certIssuer: type === 'cert_warning' ? realCertIssuer : undefined,
      certValidTo: type === 'cert_warning' ? realCertValidTo : undefined
    };
    

    await sendNotifications(env, incident, site, state.config.notifications);
    
    return jsonResponse({
      success: true,
      message: '测试通知已发送',
      site: { id: site.id, name: site.name }
    });
    
  } catch (error) {
    console.error('测试通知失败:', error);
    return errorResponse('测试通知失败: ' + error.message, 500);
  }
}

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (path === '/api/login' && method === 'POST') {
      return await handleLogin(request, env);
    }

    if (path === '/api/status' && method === 'GET') {
      return await getSitesStatus(env);
    }

    if (path === '/api/dashboard' && method === 'GET') {
      return await getDashboard(env);
    }

    if (path === '/api/incidents' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      return await getIncidents(env, Number.isFinite(limit) ? limit : 20);
    }

    if (path === '/api/history-batch' && method === 'GET') {
      const hours = parseInt(url.searchParams.get('hours') || '24');
      return await getAllSitesHistory(env, hours);
    }

    if (path === '/api/admin-path' && method === 'GET') {
      // 优先从 KV 读取，没有则用环境变量，最后用默认值
      const kvAdminPath = await env.MONITOR_DATA.get('admin_path');
      const adminPath = String(kvAdminPath || env.ADMIN_PATH || 'admin')
        .trim()
        .replace(/^\/+|\/+$/g, '') || 'admin';
      return jsonResponse({ path: adminPath });
    }

    if (path === '/api/settings' && method === 'GET') {
      return await getSettings(env);
    }

    if (path === '/api/stats' && method === 'GET') {
      return await getStats(env);
    }

    if (path === '/api/groups' && method === 'GET') {
      return await getGroups(env);
    }

    const auth = requireAuth(request);
    if (!auth.authorized) {
      return errorResponse(auth.error, 401);
    }

    if (path === '/api/sites' && method === 'GET') {
      return await getAllSites(env);
    }

    if (path === '/api/sites' && method === 'POST') {
      return await addSite(request, env);
    }

    if (path.startsWith('/api/sites/') && method === 'PUT') {
      const siteId = path.split('/')[3];
      return await updateSite(request, env, siteId);
    }

    if (path.startsWith('/api/sites/') && method === 'DELETE') {
      const siteId = path.split('/')[3];
      return await deleteSite(env, siteId);
    }

    if (path === '/api/trigger-check' && method === 'POST') {
      return await triggerCheck(env);
    }

    if (path === '/api/settings' && method === 'PUT') {
      return await updateSettings(request, env);
    }

    if (path === '/api/groups' && method === 'POST') {
      return await addGroup(request, env);
    }

    if (path.startsWith('/api/groups/') && method === 'PUT') {
      const groupId = path.split('/')[3];
      return await updateGroup(request, env, groupId);
    }

    if (path.startsWith('/api/groups/') && method === 'DELETE') {
      const groupId = path.split('/')[3];
      return await deleteGroup(env, groupId);
    }

    if (path === '/api/test-notification' && method === 'POST') {
      return await testNotification(request, env);
    }

    if (path === '/api/sites/reorder' && method === 'POST') {
      return await reorderSites(request, env);
    }

    return errorResponse('接口不存在', 404);

  } catch (error) {
    console.error('API 错误:', error);
    return errorResponse(error.message, 500);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  return await handleAPI(request, env);
}
