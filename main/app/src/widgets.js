/**
 * Dashboard Widgets Configuration
 * Manages custom dashboard layouts and widget configurations
 */

export const WIDGET_TYPES = {
  SCORE_SUMMARY: 'score_summary',
  COMPLIANCE_ISSUES: 'compliance_issues',
  RECENT_ALERTS: 'recent_alerts',
  QUICK_STATS: 'quick_stats',
  PRICE_CHANGES: 'price_changes',
  TOP_PERFORMERS: 'top_performers',
  OPPORTUNITIES: 'opportunities',
  TASKS_SUMMARY: 'tasks_summary'
};

const layouts = [];
let activeLayoutId = null;

export function getLayouts() {
  return layouts;
}

export function getActiveLayout() {
  if (!activeLayoutId || layouts.length === 0) {
    return getDefaultLayout();
  }
  const layout = layouts.find(l => l.id === activeLayoutId);
  return layout || getDefaultLayout();
}

export function saveLayout(name, widgets) {
  const id = Date.now().toString();
  const layout = {
    id,
    name,
    widgets,
    createdAt: new Date().toISOString()
  };
  layouts.push(layout);
  return layout;
}

export function setActiveLayout(layoutId) {
  const layout = layouts.find(l => l.id === layoutId);
  if (!layout) {
    throw new Error('Layout not found');
  }
  activeLayoutId = layoutId;
  return layout;
}

export function deleteLayout(layoutId) {
  const index = layouts.findIndex(l => l.id === layoutId);
  if (index === -1) {
    throw new Error('Layout not found');
  }
  layouts.splice(index, 1);
  if (activeLayoutId === layoutId) {
    activeLayoutId = null;
  }
  return { success: true };
}

export function resetToDefault() {
  activeLayoutId = null;
  return getDefaultLayout();
}

export function getWidgetConfig(widgetType) {
  const configs = {
    [WIDGET_TYPES.SCORE_SUMMARY]: {
      title: 'Score Summary',
      description: 'Overview of listing scores across 5 components',
      enabled: true
    },
    [WIDGET_TYPES.COMPLIANCE_ISSUES]: {
      title: 'Compliance Issues',
      description: 'Recent compliance violations and warnings',
      enabled: true
    },
    [WIDGET_TYPES.RECENT_ALERTS]: {
      title: 'Recent Alerts',
      description: 'Latest alerts and notifications',
      enabled: true
    },
    [WIDGET_TYPES.QUICK_STATS]: {
      title: 'Quick Stats',
      description: 'Key portfolio metrics at a glance',
      enabled: true
    },
    [WIDGET_TYPES.PRICE_CHANGES]: {
      title: 'Price Changes',
      description: 'Recent and pending price changes',
      enabled: false
    },
    [WIDGET_TYPES.TOP_PERFORMERS]: {
      title: 'Top Performers',
      description: 'Best performing listings',
      enabled: false
    },
    [WIDGET_TYPES.OPPORTUNITIES]: {
      title: 'Opportunities',
      description: 'Quick wins and optimization opportunities',
      enabled: false
    },
    [WIDGET_TYPES.TASKS_SUMMARY]: {
      title: 'Tasks Summary',
      description: 'Overview of pending tasks',
      enabled: false
    }
  };
  return configs[widgetType] || null;
}

export function updateWidgetConfig(widgetType, config) {
  // In a real implementation, this would update persistent storage
  return { success: true, widgetType, config };
}

export function toggleWidget(widgetType, enabled) {
  return updateWidgetConfig(widgetType, { enabled });
}

export function getWidgetData(widgetType) {
  // Placeholder - would return actual widget data
  return {
    type: widgetType,
    data: {},
    lastUpdated: new Date().toISOString()
  };
}

function getDefaultLayout() {
  return {
    id: 'default',
    name: 'Default Layout',
    widgets: [
      { type: WIDGET_TYPES.QUICK_STATS, order: 1 },
      { type: WIDGET_TYPES.SCORE_SUMMARY, order: 2 },
      { type: WIDGET_TYPES.COMPLIANCE_ISSUES, order: 3 },
      { type: WIDGET_TYPES.RECENT_ALERTS, order: 4 }
    ],
    createdAt: new Date().toISOString()
  };
}
