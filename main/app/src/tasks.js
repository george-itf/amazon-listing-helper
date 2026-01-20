// Kanban Task Board for Amazon Listings Helper
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'data');

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
  } catch { return null; }
}

function saveJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// Default Kanban stages
const DEFAULT_STAGES = [
  { id: 'backlog', name: 'Backlog', order: 0 },
  { id: 'todo', name: 'To Do', order: 1 },
  { id: 'in_progress', name: 'In Progress', order: 2 },
  { id: 'review', name: 'Review', order: 3 },
  { id: 'done', name: 'Done', order: 4 }
];

// Task types
const TASK_TYPES = [
  'optimization',  // Listing optimization
  'pricing',       // Price adjustment
  'content',       // Content update
  'images',        // Image updates
  'competitive',   // Competitive response
  'inventory',     // Stock management
  'other'
];

function initTasks() {
  const tasks = loadJSON('tasks.json');
  if (!tasks) {
    saveJSON('tasks.json', {
      stages: DEFAULT_STAGES,
      tasks: [],
      lastId: 0
    });
  }
  return loadJSON('tasks.json');
}

function getTasks() {
  return initTasks();
}

function getTasksByStage() {
  const data = initTasks();
  const byStage = {};
  
  for (const stage of data.stages) {
    byStage[stage.id] = {
      ...stage,
      tasks: data.tasks
        .filter(t => t.stage === stage.id && !t.archived)
        .sort((a, b) => a.order - b.order)
    };
  }
  
  return byStage;
}

function createTask(task) {
  const data = initTasks();
  const newId = ++data.lastId;
  
  const newTask = {
    id: newId,
    title: task.title,
    description: task.description || '',
    taskType: task.taskType || 'other',
    stage: task.stage || 'backlog',
    priority: task.priority || 'medium', // low, medium, high, critical
    sku: task.sku || null,
    asin: task.asin || null,
    dueDate: task.dueDate || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: task.createdBy || 'user',
    order: data.tasks.filter(t => t.stage === (task.stage || 'backlog')).length,
    archived: false,
    completedAt: null
  };
  
  data.tasks.push(newTask);
  saveJSON('tasks.json', data);
  
  return newTask;
}

function updateTask(taskId, updates) {
  const data = initTasks();
  const taskIndex = data.tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) return null;
  
  const task = data.tasks[taskIndex];
  const wasCompleted = task.stage === 'done';
  const isNowCompleted = updates.stage === 'done';
  
  data.tasks[taskIndex] = {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
    completedAt: !wasCompleted && isNowCompleted ? new Date().toISOString() : task.completedAt
  };
  
  saveJSON('tasks.json', data);
  return data.tasks[taskIndex];
}

function moveTask(taskId, newStage, newOrder) {
  const data = initTasks();
  const taskIndex = data.tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) return null;
  
  const task = data.tasks[taskIndex];
  const oldStage = task.stage;
  
  // Update the moved task
  task.stage = newStage;
  task.order = newOrder;
  task.updatedAt = new Date().toISOString();
  
  if (oldStage !== 'done' && newStage === 'done') {
    task.completedAt = new Date().toISOString();
  }
  
  // Reorder other tasks in the new stage
  data.tasks
    .filter(t => t.stage === newStage && t.id !== taskId)
    .sort((a, b) => a.order - b.order)
    .forEach((t, idx) => {
      if (idx >= newOrder) {
        t.order = idx + 1;
      }
    });
  
  saveJSON('tasks.json', data);
  return task;
}

function deleteTask(taskId) {
  const data = initTasks();
  const taskIndex = data.tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) return false;
  
  // Soft delete - archive instead
  data.tasks[taskIndex].archived = true;
  data.tasks[taskIndex].updatedAt = new Date().toISOString();
  
  saveJSON('tasks.json', data);
  return true;
}

function getTaskStats() {
  const data = initTasks();
  const activeTasks = data.tasks.filter(t => !t.archived);
  
  return {
    total: activeTasks.length,
    byStage: data.stages.reduce((acc, stage) => {
      acc[stage.id] = activeTasks.filter(t => t.stage === stage.id).length;
      return acc;
    }, {}),
    byPriority: {
      critical: activeTasks.filter(t => t.priority === 'critical').length,
      high: activeTasks.filter(t => t.priority === 'high').length,
      medium: activeTasks.filter(t => t.priority === 'medium').length,
      low: activeTasks.filter(t => t.priority === 'low').length
    },
    overdue: activeTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.stage !== 'done').length,
    completedThisWeek: activeTasks.filter(t => {
      if (!t.completedAt) return false;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(t.completedAt) > weekAgo;
    }).length
  };
}

// Auto-generate tasks from low scores
function generateTasksFromScores(threshold = 50) {
  const scores = loadJSON('scores.json') || {};
  const listings = loadJSON('listings.json');
  const data = initTasks();
  const items = listings?.items || [];
  
  const existingSkus = new Set(data.tasks.filter(t => !t.archived && t.stage !== 'done').map(t => t.sku));
  const newTasks = [];
  
  for (const item of items) {
    const score = scores[item.sku]?.totalScore;
    if (score && score < threshold && !existingSkus.has(item.sku)) {
      newTasks.push(createTask({
        title: `Optimize: ${(item.title || item.sku).substring(0, 50)}...`,
        description: `Score: ${score}/100. Review and improve listing quality.`,
        taskType: 'optimization',
        stage: 'backlog',
        priority: score < 30 ? 'high' : 'medium',
        sku: item.sku,
        asin: item.asin,
        createdBy: 'automation'
      }));
    }
  }
  
  return newTasks;
}

export { 
  getTasks, 
  getTasksByStage, 
  createTask, 
  updateTask, 
  moveTask, 
  deleteTask, 
  getTaskStats,
  generateTasksFromScores,
  TASK_TYPES,
  DEFAULT_STAGES
};
