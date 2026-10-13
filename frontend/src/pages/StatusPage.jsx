import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Server,
  ServerCog, 
  ServerCrash, 
  TrendingUp,
  Gauge
} from 'lucide-react';
import { api } from '../utils/api';
import { 
  formatResponseTime, 
  groupSites 
} from '../utils/helpers';
import { REFRESH_INTERVAL } from '../config';
import StatsCard from '../components/StatsCard';
import SiteCard from '../components/SiteCard';
import StarryBackground from '../components/StarryBackground';
import ThemeToggle from '../components/ThemeToggle';
import IncidentCarousel from '../components/IncidentCarousel';
import { useHistory } from '../context/HistoryContext';

export default function StatusPage() {
  const [sites, setSites] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [siteSettings, setSiteSettings] = useState({
    siteName: '大叔巡站',
    siteSubtitle: '大叔日记 · 站点状态监控',
    pageTitle: '网站监控'
  });
  
  const { fetchAllHistory, historyCache } = useHistory();

  const loadData = async () => {
    try {
      const dashboard = await api.getDashboard();
      const sitesList = Array.isArray(dashboard?.sites) ? dashboard.sites : [];
      const groupList = Array.isArray(dashboard?.groups) ? dashboard.groups : [];
      const cfg = dashboard?.settings || {};

      setSites(sitesList);
      setGroups(groupList);
      setDashboardError('');
      const settings = {
        siteName: cfg.siteName || '大叔巡站',
        siteSubtitle: cfg.siteSubtitle || '大叔日记 · 站点状态监控',
        pageTitle: cfg.pageTitle || '网站监控'
      };
      setSiteSettings(settings);
      document.title = `${settings.siteName} - ${settings.pageTitle}`;
      setLastUpdate(Date.now());

      const inc = Array.isArray(dashboard?.incidents) ? dashboard.incidents : [];
      setIncidents(inc);


      let historyHours = 24;
      try {
        const savedSettings = localStorage.getItem('monitorSettings');
        if (savedSettings) {
          const storeSettings = JSON.parse(savedSettings);
          if (storeSettings && typeof storeSettings.historyHours === 'number') {
            historyHours = storeSettings.historyHours;
          }
        }
      } catch (error) {
        console.warn('monitorSettings 解析失败，使用默认历史范围', error);
      }
      fetchAllHistory(historyHours || 24);
    } catch (error) {
      console.error('加载仪表盘失败:', error);
      setDashboardError(error instanceof TypeError
        ? '暂时无法连接监控服务，请检查网络或本地 API 服务后重试。'
        : error.message || '仪表盘加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [autoRefresh]);


  const calculateAvgResponseTime = () => {
    if (sites.length === 0) return 0;
    
    let totalResponseTime = 0;
    let totalCount = 0;
    
    for (const site of sites) {
      const siteHistory = historyCache[site.id]?.history || [];

      const recentRecords = siteHistory.slice(0, 30);
      
      for (const record of recentRecords) {
        if (record.responseTime && record.responseTime > 0) {
          totalResponseTime += record.responseTime;
          totalCount++;
        }
      }
    }
    
    return totalCount > 0 ? Math.round(totalResponseTime / totalCount) : 0;
  };

  const globalStats = {
    total: sites.length,
    online: sites.filter(s => s.status === 'online').length,
    offline: sites.filter(s => s.status === 'offline').length,
    avgResponseTime: calculateAvgResponseTime(),
  };


  const lastCheckTime = sites.length > 0
    ? Math.max(...sites.map(s => s.lastCheck || 0))
    : null;

  const groupedSites = groupSites(sites, groups);

  return (
    <div className="flex flex-col min-h-screen relative">
      {/* 星空背景 */}
      <StarryBackground />
      
      {/* 头部 */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/40 dark:bg-[#0d0d0d]/40 shadow-sm" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-[1]">
          <div className="grid grid-cols-[minmax(0,1fr),auto] md:grid-cols-[auto,1fr,auto] items-center h-16 gap-2 sm:gap-4">
            {/* Logo */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex items-center gap-4 min-w-0"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20">
                <img src="/img/ds-diary-mark.svg" alt="大叔日记" className="w-9 h-9 rounded-lg" />
              </div>
              <div className="flex flex-col min-w-0">
                <h1 className="text-base sm:text-xl font-bold text-slate-900 dark:text-[#e8f2f4] tracking-tight truncate">
                  {siteSettings.siteName}
                </h1>
                <p className="max-w-full truncate text-[9px] sm:text-xs font-medium text-slate-500 dark:text-[#7d9ba4] tracking-[0.08em] sm:tracking-[0.12em]">
                  {siteSettings.siteSubtitle}
                </p>
              </div>
            </motion.div>

            {/* 中间 - 最后监测时间 */}
            {lastCheckTime && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="hidden md:flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"></div>
                <span className="font-medium whitespace-nowrap">
                  数据更新: {new Date(lastCheckTime).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  }).replace(/\//g, '-')}
                </span>
              </motion.div>
            )}

            {/* 右侧区域 */}
            <div className="flex items-center gap-3 justify-end">
              {/* 主题切换按钮 */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <ThemeToggle />
              </motion.div>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="relative z-[1] flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <p className="text-[10px] sm:text-xs font-semibold tracking-[0.24em] text-cyan-700 dark:text-[#20bfd0] uppercase mb-2">
              DS SITEWATCH <span className="text-slate-400 dark:text-[#46636c]">//</span> BY DS DIARY
            </p>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#edf6f7]">
              站点运行概况
            </h2>
          </div>
          <div className="text-xs sm:text-sm text-slate-500 dark:text-[#78939b]">
            实时掌握网站可用性与响应状态
          </div>
        </div>

        {/* 全局统计卡片 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-8">
          <StatsCard
            icon={Server}
            label="总站点数"
            value={globalStats.total}
            color="blue"
          />
          <StatsCard
            icon={ServerCog}
            label="在线站点"
            value={globalStats.online}
            color="green"
          />
          <StatsCard
            icon={ServerCrash}
            label="离线站点"
            value={globalStats.offline}
            color="red"
          />
          <StatsCard
            icon={Gauge}
            label="平均响应"
            value={formatResponseTime(globalStats.avgResponseTime)}
            color="purple"
          />
        </div>

        {/* 异常通知轮播 */}
        <div className="mb-8">
          <IncidentCarousel autoInterval={5000} initialIncidents={incidents} />
        </div>

        {/* 站点状态 */}
        {loading ? (
          <div className="glass-card p-12 text-center">
            <div className="loading-dots text-primary-600 dark:text-primary-400">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p className="mt-4 text-slate-500 dark:text-slate-400">加载中...</p>
          </div>
        ) : dashboardError && sites.length === 0 ? (
          <div className="glass-card p-6 sm:p-10 text-center" role="alert" aria-live="polite">
            <p className="text-base sm:text-lg font-medium text-slate-800 dark:text-slate-100 mb-2">监控数据暂时不可用</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{dashboardError}</p>
            <button type="button" onClick={() => { setLoading(true); loadData(); }} className="btn-primary min-h-11 px-5 py-2.5">
              重试
            </button>
          </div>
        ) : sites.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-12 text-center"
          >
            <TrendingUp className="w-16 h-16 mx-auto text-slate-400 mb-4" />
            <p className="text-xl font-medium text-slate-600 dark:text-slate-300 mb-2">
              暂无监控站点
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              暂无可显示的监控站点
            </p>
          </motion.div>
        ) : (
          <>
          {dashboardError && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-300/70 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200" role="status">
              <span>数据刷新失败，当前显示的是上次加载结果。{dashboardError}</span>
              <button type="button" onClick={() => { setLoading(true); loadData(); }} className="min-h-11 shrink-0 rounded-lg border border-amber-400/70 px-4 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40">
                重试
              </button>
            </div>
          )}
          <div className="space-y-6">
            {Object.entries(groupedSites).map(([group, groupSites], groupIndex) => (
              <motion.div
                key={group}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: groupIndex * 0.05, ease: "easeOut" }}
                className="space-y-3"
              >
                {/* 分类标题 */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 pl-9 sm:pl-10">
                  {(() => {
                    const groupObj = groups.find(g => g.name === group);
                    return groupObj?.icon ? (
                      <i 
                        className={`${groupObj.icon} w-10 h-10 flex items-center justify-center text-3xl flex-shrink-0`}
                        style={{ color: groupObj.iconColor || 'currentColor' }}
                      />
                    ) : null;
                  })()}
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                    {group}
                  </h2>
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    {groupSites.length} 个站点
                  </span>
                </div>

                {/* 站点列表 */}
                <div className="glass-card p-4 sm:p-5">
                  <div className="space-y-0">
                    {groupSites.map((site) => (
                      <SiteCard
                        key={site.id}
                        site={site}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          </>
        )}
      </main>

      {/* 页脚 */}
      <footer className="status-footer py-4 mt-auto" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="relative z-[1] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            © {new Date().getFullYear()} {siteSettings.siteName} · 网站监控平台
          </p>
        </div>
      </footer>

      {/* 历史数据详情功能已移除 */}
    </div>
  );
}
