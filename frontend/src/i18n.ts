export type Lang = 'zh' | 'en';

export const STRINGS = {
  en: {
    brand: 'agent workbench',
    noAgent: 'no agent selected',
    theme: 'Toggle theme',
    light: 'light',
    dark: 'dark',
    switchLanguage: 'Switch language',
    agents: 'Agents',
    tasks: 'Tasks',
    session: 'Session',
    progress: 'Progress',
    adopt: 'Adopt',
    release: 'Release',
    taskTitle: 'Task title',
    description: 'Description',
    create: 'Create',
    plan: 'Plan',
    proposedSplit: 'Proposed split — edit before confirming',
    confirm: 'Confirm',
    cancel: 'Cancel',
    selectAgent: 'Select an agent to view its sessions.',
    openTask: 'Open a task to see its parts.',
    loading: 'Loading…',
    conversations: 'Conversations',
    workspace: 'Workspace',
    runDirectory: 'Run directory',
    noConversations: 'No conversations yet.',
    status_discovered: 'discovered',
    status_adopted: 'adopted',
    status_running: 'running',
    status_idle: 'idle',
    status_exited: 'exited',
    status_planned: 'planned',
    status_active: 'active',
    status_paused: 'paused',
    status_done: 'done',
    status_cancelled: 'cancelled',
    status_pending: 'pending',
    status_proposed: 'proposed',
    status_failed: 'failed',
  },
  zh: {
    brand: '智能体工作台',
    noAgent: '未选择智能体',
    theme: '切换主题',
    light: '浅色',
    dark: '深色',
    switchLanguage: '切换语言',
    agents: '智能体',
    tasks: '任务',
    session: '会话',
    progress: '进度',
    adopt: '接管',
    release: '释放',
    taskTitle: '任务标题',
    description: '描述',
    create: '创建',
    plan: '拆分方案',
    proposedSplit: '建议拆分 — 确认前可编辑',
    confirm: '确认',
    cancel: '取消',
    selectAgent: '选择一个智能体查看其会话。',
    openTask: '打开一个任务查看其分片。',
    loading: '加载中…',
    conversations: '对话',
    workspace: '工作区',
    runDirectory: '运行目录',
    noConversations: '暂无对话。',
    status_discovered: '已发现',
    status_adopted: '已接管',
    status_running: '运行中',
    status_idle: '空闲',
    status_exited: '已退出',
    status_planned: '已规划',
    status_active: '进行中',
    status_paused: '已暂停',
    status_done: '完成',
    status_cancelled: '已取消',
    status_pending: '待处理',
    status_proposed: '建议中',
    status_failed: '失败',
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

export function translate(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key] ?? STRINGS.en[key];
}

export function statusKey(status: string): StringKey {
  return `status_${status}` as StringKey;
}

const STORAGE_KEY = 'aw-lang';

export function getStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) return 'zh';
  } catch {
    /* navigator unavailable */
  }
  return 'en';
}

export function applyLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }
}
