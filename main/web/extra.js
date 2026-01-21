// ============================================
// GLOBAL UTILITY FUNCTIONS
// ============================================

// Escape HTML to prevent XSS attacks - MUST be defined at top level
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Safe number formatting with fallback
function safeToFixed(value, decimals = 2) {
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num.toFixed(decimals);
}

// Safe property access helper
function safeGet(obj, path, defaultValue = null) {
  try {
    const result = path.split('.').reduce((o, k) => (o || {})[k], obj);
    return result !== undefined ? result : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// ============================================
// PAGE FUNCTIONS
// ============================================

async function calcShipping() {
  const r = document.getElementById("ship-result");
  if (!r) return;
  const w=document.getElementById("ship-weight")?.value || 0;
  const l=document.getElementById("ship-length")?.value || 0;
  const wd=document.getElementById("ship-width")?.value || 0;
  const h=document.getElementById("ship-height")?.value || 0;
  try {
    const res = await fetch("/api/v1/shipping/rates?weight="+w+"&length="+l+"&width="+wd+"&height="+h);
    const d = await res.json();
    const data = d?.data || d || {};
    let out = "<div class='p-4 bg-gray-50 rounded'><b>"+(data.parcelType || 'Unknown')+"</b><br>";
    if(data.options) data.options.forEach(function(o){out+="<div>"+escapeHtml(o.service)+": <b>£"+safeToFixed(o.price)+"</b> ("+o.deliveryDays+" days)</div>";});
    if(data.error) out="<p class='text-red-600'>"+escapeHtml(data.error)+"</p>";
    out+="</div>";
    r.innerHTML=out;
  } catch(e) { r.innerHTML="<p class='text-red-500'>"+escapeHtml(e.message)+"</p>"; }
}

async function loadOptimize() {
  const c = document.getElementById("optimize-container");
  if (!c) return;
  c.innerHTML="<p class='p-4'>Loading...</p>";
  try {
    const res = await fetch("/api/v1/optimize");
    const d = await res.json();
    const data = d?.data || d || {};
    const summary = data.summary || {};
    const opportunities = data.opportunities || [];

    const optHigh = document.getElementById("opt-high");
    const optMedium = document.getElementById("opt-medium");
    const optLow = document.getElementById("opt-low");
    if (optHigh) optHigh.textContent = summary.high || 0;
    if (optMedium) optMedium.textContent = summary.medium || 0;
    if (optLow) optLow.textContent = summary.low || 0;

    if(!opportunities.length) { c.innerHTML="<p class='p-4 text-green-600'>All optimized!</p>"; return; }
    let h="<table class='w-full text-sm'><thead class='bg-gray-50'><tr><th class='p-3 text-left'>Priority</th><th class='p-3 text-left'>Product</th><th class='p-3 text-right'>Price</th><th class='p-3 text-right'>Buy Box</th><th class='p-3 text-right'>Profit</th><th class='p-3'>Issue</th><th class='p-3'></th></tr></thead><tbody>";
    opportunities.forEach(function(i){
      var sc=i.severity==="high"?"bg-red-100 text-red-800":i.severity==="medium"?"bg-yellow-100 text-yellow-800":"bg-blue-100 text-blue-800";
      var escSku = (i.sku || '').replace(/'/g, "\\'");
      h+="<tr class='border-t'><td class='p-3'><span class='px-2 py-1 rounded text-xs "+sc+"'>"+escapeHtml(i.severity)+"</span></td><td class='p-3 max-w-xs truncate'>"+escapeHtml(i.title)+"</td><td class='p-3 text-right'>£"+safeToFixed(i.currentPrice)+"</td><td class='p-3 text-right'>"+(i.buyBoxPrice>0?"£"+safeToFixed(i.buyBoxPrice):"-")+"</td><td class='p-3 text-right "+(i.profit>0?"text-green-600":"text-red-600")+"'>£"+safeToFixed(i.profit)+"</td><td class='p-3 text-xs text-gray-500'>"+escapeHtml(i.message)+"</td><td class='p-3'><button onclick=\"showOptDetail('"+escSku+"')\" class='text-blue-600 text-xs'>View</button></td></tr>";
    });
    h+="</tbody></table>";
    c.innerHTML=h;
  } catch(e) { c.innerHTML="<p class='p-4 text-red-500'>"+escapeHtml(e.message)+"</p>"; }
}

async function showOptDetail(sku) {
  document.querySelectorAll("[id^='page-']").forEach(function(p){p.classList.add("hidden");});
  document.getElementById("page-opt-detail").classList.remove("hidden");
  const c = document.getElementById("opt-detail");
  c.innerHTML="<p>Loading...</p>";
  try {
    const res = await fetch("/api/v1/optimize/"+encodeURIComponent(sku));
    const d = await res.json();
    let h="<div class='bg-white rounded border p-6 mb-4'><h2 class='text-xl font-bold mb-2'>"+d.data.title.substring(0,60)+"</h2><p class='text-sm text-gray-500 mb-4'>SKU: "+d.data.sku+"</p>";
    h+="<div class='grid grid-cols-4 gap-4'><div class='p-3 bg-gray-50 rounded'><p class='text-xs'>Price</p><p class='font-bold'>£"+(parseFloat(d.data.current?.price)||0).toFixed(2)+"</p></div>";
    h+="<div class='p-3 bg-gray-50 rounded'><p class='text-xs'>Buy Box</p><p class='font-bold'>"+(d.data.buyBoxPrice>0?"£"+(parseFloat(d.data.buyBoxPrice)||0).toFixed(2):"-")+"</p></div>";
    h+="<div class='p-3 bg-gray-50 rounded'><p class='text-xs'>Break Even</p><p class='font-bold'>£"+(parseFloat(d.data.breakEven)||0).toFixed(2)+"</p></div>";
    h+="<div class='p-3 "+(d.data.current?.profit>0?"bg-green-50":"bg-red-50")+" rounded'><p class='text-xs'>Profit</p><p class='font-bold'>£"+(parseFloat(d.data.current?.profit)||0).toFixed(2)+" ("+(d.data.current?.margin||0)+"%)</p></div></div></div>";
    h+="<div class='bg-white rounded border p-6 mb-4'><h3 class='font-semibold mb-3'>Costs</h3><div class='grid grid-cols-5 gap-2 text-sm'>";
    h+="<div class='p-2 bg-gray-50 rounded text-center'>Product<br><b>£"+(parseFloat(d.data.costs?.product)||0).toFixed(2)+"</b></div>";
    h+="<div class='p-2 bg-gray-50 rounded text-center'>Shipping<br><b>£"+(parseFloat(d.data.costs?.shipping)||0).toFixed(2)+"</b></div>";
    h+="<div class='p-2 bg-gray-50 rounded text-center'>Packaging<br><b>£"+(parseFloat(d.data.costs?.packaging)||0).toFixed(2)+"</b></div>";
    h+="<div class='p-2 bg-gray-50 rounded text-center'>Other<br><b>£"+(parseFloat(d.data.costs?.other)||0).toFixed(2)+"</b></div>";
    h+="<div class='p-2 bg-blue-50 rounded text-center'>Total<br><b class='text-blue-700'>£"+(parseFloat(d.data.costs?.total)||0).toFixed(2)+"</b></div></div></div>";
    if(d.data.recommendations && d.data.recommendations.length) {
      h+="<div class='bg-white rounded border p-6'><h3 class='font-semibold mb-3'>Recommendations</h3><div class='space-y-2'>";
      d.data.recommendations.forEach(function(r){
        h+="<div class='p-3 border rounded flex justify-between'><div><b>"+r.strategy+"</b><p class='text-sm text-gray-500'>"+r.reason+"</p></div><div class='text-right'><span class='text-lg font-bold'>£"+(parseFloat(r.price)||0).toFixed(2)+"</span><br><span class='text-sm "+(r.profit>0?"text-green-600":"text-red-600")+"'>£"+(parseFloat(r.profit)||0).toFixed(2)+" ("+(r.margin||0)+"%)</span></div></div>";
      });
      h+="</div></div>";
    }
    c.innerHTML=h;
  } catch(e) { c.innerHTML="<p class='text-red-500'>"+e.message+"</p>"; }
}

async function loadAlerts() {
  const c = document.getElementById("alerts-container");
  if (!c) return;
  c.innerHTML = "<p class='p-4'>Loading...</p>";
  try {
    const res = await fetch("/api/v1/alerts");
    const d = await res.json();
    const data = d?.data || d || {};
    const summary = data.summary || {};
    const alerts = data.alerts || [];

    const alertCritical = document.getElementById("alert-critical");
    const alertHigh = document.getElementById("alert-high");
    const alertMedium = document.getElementById("alert-medium");
    const alertLow = document.getElementById("alert-low");
    if (alertCritical) alertCritical.textContent = summary.critical || 0;
    if (alertHigh) alertHigh.textContent = summary.high || 0;
    if (alertMedium) alertMedium.textContent = summary.medium || 0;
    if (alertLow) alertLow.textContent = summary.low || 0;

    if (!alerts.length) { c.innerHTML = "<p class='p-4 text-green-600'>No alerts!</p>"; return; }
    let h = "<table class='w-full text-sm'><thead class='bg-gray-50'><tr><th class='p-3 text-left'>Severity</th><th class='p-3 text-left'>Rule</th><th class='p-3 text-left'>Product</th><th class='p-3 text-left'>Message</th><th class='p-3 text-left'>Time</th></tr></thead><tbody>";
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var sc = a.severity === "critical" ? "bg-red-100 text-red-800" : a.severity === "high" ? "bg-orange-100 text-orange-800" : a.severity === "medium" ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800";
      var rowClass = a.read ? "border-t opacity-50" : "border-t bg-yellow-50";
      h += "<tr class='" + rowClass + "'><td class='p-3'><span class='px-2 py-1 rounded text-xs " + sc + "'>" + escapeHtml(a.severity || "") + "</span></td>";
      h += "<td class='p-3'>" + escapeHtml(a.ruleName || "") + "</td>";
      h += "<td class='p-3 max-w-xs truncate'>" + escapeHtml(a.title || "") + "</td>";
      h += "<td class='p-3 text-gray-600'>" + escapeHtml(a.message || "") + "</td>";
      h += "<td class='p-3 text-xs text-gray-400'>" + (a.createdAt ? new Date(a.createdAt).toLocaleString() : "") + "</td></tr>";
    }
    h += "</tbody></table>";
    c.innerHTML = h;
  } catch(e) { c.innerHTML = "<p class='p-4 text-red-500'>" + escapeHtml(e.message) + "</p>"; }
}

async function runAutomation() {
  try {
    await fetch("/api/v1/automation/run", { method: "POST" });
    loadAlerts();
  } catch(e) { alert(e.message); }
}

async function markAllRead() {
  try {
    await fetch("/api/v1/alerts/read-all", { method: "POST" });
    loadAlerts();
  } catch(e) { alert(e.message); }
}
// Dashboard Stats

// Dashboard Stats
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/v1/dashboard/stats');
    const data = await res.json();
    const el = document.getElementById('dashboard-enhanced');
    if (!el) return;
    
    el.innerHTML = `
      <div class="grid md:grid-cols-2 gap-6 mb-6">
        <div class="bg-white p-4 rounded-lg shadow">
          <h3 class="font-semibold mb-3">Score Distribution</h3>
          <div class="space-y-2">
            ${data.charts.scoreDistribution.map(d => `
              <div class="flex items-center">
                <div class="w-16 text-sm text-gray-600">${d.range}</div>
                <div class="flex-1 bg-gray-200 rounded h-6 mx-2">
                  <div class="bg-blue-500 h-6 rounded" style="width: ${(d.count / data.summary.totalListings * 100)}%"></div>
                </div>
                <div class="w-8 text-sm text-right">${d.count}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow">
          <h3 class="font-semibold mb-3">Price Distribution</h3>
          <div class="space-y-2">
            ${data.charts.priceRanges.map(d => `
              <div class="flex items-center">
                <div class="w-16 text-sm text-gray-600">${d.range}</div>
                <div class="flex-1 bg-gray-200 rounded h-6 mx-2">
                  <div class="bg-green-500 h-6 rounded" style="width: ${(d.count / data.summary.totalListings * 100)}%"></div>
                </div>
                <div class="w-8 text-sm text-right">${d.count}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white p-4 rounded-lg shadow">
          <h3 class="font-semibold mb-3">Top Issues to Fix</h3>
          <div class="space-y-2">
            ${data.topIssues.map((issue, i) => `
              <div class="flex justify-between items-center py-1 border-b">
                <span class="text-sm">${i+1}. ${issue.issue}</span>
                <span class="text-sm font-medium text-red-600">${issue.count} listings</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="bg-white p-4 rounded-lg shadow">
          <h3 class="font-semibold mb-3">Needs Attention (Lowest Scores)</h3>
          <div class="space-y-2 max-h-64 overflow-y-auto">
            ${data.needsAttention.map(item => `
              <div class="flex justify-between items-center py-1 border-b text-sm">
                <span class="truncate flex-1 mr-2">${item.title.substring(0, 40)}...</span>
                <span class="font-medium ${item.score < 40 ? 'text-red-600' : 'text-orange-600'}">${item.score}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="mt-6 text-center">
        <a href="/api/v1/dashboard/export" class="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600">Export CSV Report</a>
        <span class="text-gray-500 text-sm ml-4">Last sync: ${data.lastSync ? new Date(data.lastSync).toLocaleString() : 'Never'}</span>
      </div>
    `;
  } catch (e) {
    console.error('Dashboard stats error:', e);
  }
}

// Auto-load dashboard stats on page load
document.addEventListener('DOMContentLoaded', () => { setTimeout(loadDashboardStats, 200); });

// AI Recommendations
async function loadAIBulk() {
  try {
    const res = await fetch('/api/v1/ai/bulk-recommendations?limit=15');
    const data = await res.json();
    const el = document.getElementById('ai-bulk-list');
    if (!el) return;
    
    el.innerHTML = `
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th class="text-left py-2">SKU</th><th class="text-left">Title</th><th class="text-left">Score</th><th class="text-left">Top Issue</th><th></th></tr></thead>
        <tbody>
          ${data.map(item => `
            <tr class="border-b hover:bg-gray-50">
              <td class="py-2 font-mono text-xs">${item.sku}</td>
              <td class="truncate max-w-xs">${item.title}</td>
              <td><span class="px-2 py-1 rounded ${item.score < 40 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">${item.score}</span></td>
              <td class="text-gray-600">${item.topIssue}</td>
              <td><button onclick="loadAIDetail('${item.sku}')" class="text-blue-600 hover:underline">View</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('AI bulk error:', e);
  }
}

async function loadAIDetail(sku) {
  try {
    const res = await fetch('/api/v1/ai/recommendations/' + encodeURIComponent(sku));
    const data = await res.json();
    
    document.getElementById('ai-sku').textContent = sku + ' (Score: ' + data.currentScore + ')';
    document.getElementById('ai-detail').classList.remove('hidden');
    
    const el = document.getElementById('ai-recommendations');
    el.innerHTML = `
      <div class="mb-4 p-3 bg-blue-50 rounded">
        <strong>Quick Wins:</strong> ${data.quickWins?.join(', ') || 'None identified'}
      </div>
      ${data.recommendations?.map(rec => `
        <div class="mb-4 p-4 border rounded">
          <div class="flex justify-between items-center mb-2">
            <h4 class="font-semibold">${rec.category}</h4>
            <span class="px-2 py-1 text-xs rounded ${rec.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">${rec.priority}</span>
          </div>
          ${rec.current ? `<p class="text-sm text-gray-600 mb-2"><strong>Current:</strong> ${rec.current}</p>` : ''}
          <ul class="list-disc list-inside text-sm space-y-1">
            ${rec.suggestions?.map(s => `<li>${s}</li>`).join('') || ''}
          </ul>
        </div>
      `).join('') || '<p>No recommendations available</p>'}
    `;
  } catch (e) {
    console.error('AI detail error:', e);
  }
}

// Kanban Task Board
async function loadTasks() {
  try {
    const [tasksRes, statsRes] = await Promise.all([
      fetch('/api/v1/tasks'),
      fetch('/api/v1/tasks/stats')
    ]);
    const tasks = await tasksRes.json();
    const stats = await statsRes.json();
    
    // Render stats
    document.getElementById('task-stats').innerHTML = `
      <div class="bg-white p-4 rounded shadow"><div class="text-2xl font-bold">${stats.total}</div><div class="text-gray-500 text-sm">Total Tasks</div></div>
      <div class="bg-white p-4 rounded shadow"><div class="text-2xl font-bold text-blue-600">${stats.byStage.in_progress || 0}</div><div class="text-gray-500 text-sm">In Progress</div></div>
      <div class="bg-white p-4 rounded shadow"><div class="text-2xl font-bold text-green-600">${stats.completedThisWeek}</div><div class="text-gray-500 text-sm">Done This Week</div></div>
      <div class="bg-white p-4 rounded shadow"><div class="text-2xl font-bold ${stats.overdue > 0 ? 'text-red-600' : ''}">${stats.overdue}</div><div class="text-gray-500 text-sm">Overdue</div></div>
    `;
    
    // Render Kanban board
    const stages = ['backlog', 'todo', 'in_progress', 'review', 'done'];
    const stageNames = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Done' };
    const stageColors = { backlog: 'gray', todo: 'blue', in_progress: 'yellow', review: 'purple', done: 'green' };
    
    document.getElementById('kanban-board').innerHTML = stages.map(stage => `
      <div class="flex-shrink-0 w-72 bg-gray-100 rounded-lg p-3" data-stage="${stage}">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-semibold text-${stageColors[stage]}-700">${stageNames[stage]}</h3>
          <span class="bg-${stageColors[stage]}-200 text-${stageColors[stage]}-800 text-xs px-2 py-1 rounded-full">${tasks[stage]?.tasks?.length || 0}</span>
        </div>
        <div class="space-y-2 min-h-[200px]" id="stage-${stage}">
          ${(tasks[stage]?.tasks || []).map(task => renderTaskCard(task)).join('')}
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Load tasks error:', e);
  }
}

function renderTaskCard(task) {
  const priorityColors = { critical: 'red', high: 'orange', medium: 'blue', low: 'gray' };
  const typeIcons = { optimization: '⚡', pricing: '💰', content: '📝', images: '🖼️', competitive: '🎯', other: '📋' };
  return `
    <div class="bg-white p-3 rounded shadow cursor-pointer hover:shadow-md" onclick="showTaskDetail(${task.id})">
      <div class="flex justify-between items-start mb-2">
        <span class="text-xs">${typeIcons[task.taskType] || '📋'}</span>
        <span class="text-xs px-2 py-0.5 rounded bg-${priorityColors[task.priority]}-100 text-${priorityColors[task.priority]}-700">${task.priority}</span>
      </div>
      <div class="text-sm font-medium mb-1">${task.title.substring(0, 50)}${task.title.length > 50 ? '...' : ''}</div>
      ${task.sku ? `<div class="text-xs text-gray-500 font-mono">${task.sku}</div>` : ''}
      <div class="flex justify-between mt-2 text-xs text-gray-400">
        <span>#${task.id}</span>
        ${task.stage !== 'done' ? `<select onchange="moveTaskTo(${task.id}, this.value)" class="text-xs border rounded px-1" onclick="event.stopPropagation()">
          <option value="">Move...</option>
          <option value="backlog">Backlog</option>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="review">Review</option>
          <option value="done">Done</option>
        </select>` : '✓'}
      </div>
    </div>
  `;
}

async function moveTaskTo(taskId, stage) {
  if (!stage) return;
  await fetch(`/api/v1/tasks/${taskId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, order: 0 })
  });
  loadTasks();
}

function showAddTask() {
  document.getElementById('add-task-modal').classList.remove('hidden');
}

function hideAddTask() {
  document.getElementById('add-task-modal').classList.add('hidden');
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  document.getElementById('task-sku').value = '';
}

async function saveTask() {
  const task = {
    title: document.getElementById('task-title').value,
    description: document.getElementById('task-desc').value,
    taskType: document.getElementById('task-type').value,
    priority: document.getElementById('task-priority').value,
    sku: document.getElementById('task-sku').value || null
  };
  
  await fetch('/api/v1/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  
  hideAddTask();
  loadTasks();
}

async function generateTasks() {
  const res = await fetch('/api/v1/tasks/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threshold: 50 }) });
  const data = await res.json();
  alert(`Generated ${data.created} tasks from low-scoring listings`);
  loadTasks();
}

async function showTaskDetail(taskId) {
  // For now, just allow editing via move dropdown
  // Could expand to full modal later
}

// Push to Amazon
async function loadChanges() {
  try {
    const res = await fetch('/api/v1/changes?all=true');
    const changes = await res.json();
    
    const el = document.getElementById('changes-list');
    if (changes.length === 0) {
      el.innerHTML = '<p class="text-gray-500">No changes queued</p>';
      return;
    }
    
    const statusColors = { pending: 'yellow', submitted: 'blue', completed: 'green', failed: 'red', cancelled: 'gray' };
    
    el.innerHTML = `
      <table class="w-full text-sm">
        <thead><tr class="border-b"><th class="text-left py-2">SKU</th><th class="text-left">Type</th><th class="text-left">Change</th><th class="text-left">Status</th><th class="text-left">Date</th><th></th></tr></thead>
        <tbody>
          ${changes.slice().reverse().map(c => `
            <tr class="border-b">
              <td class="py-2 font-mono text-xs">${c.sku}</td>
              <td>${c.type}</td>
              <td>${c.type === 'price' ? `£${(parseFloat(c.oldValue)||0).toFixed(2)} → £${(parseFloat(c.newValue)||0).toFixed(2)}` : 'Listing update'}</td>
              <td><span class="px-2 py-1 rounded text-xs bg-${statusColors[c.status]}-100 text-${statusColors[c.status]}-700">${c.status}</span></td>
              <td class="text-xs text-gray-500">${new Date(c.createdAt).toLocaleDateString()}</td>
              <td>${c.status === 'pending' ? `<button onclick="cancelChangeItem(${c.id})" class="text-red-600 hover:underline text-xs">Cancel</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('Load changes error:', e);
  }
}

async function queuePrice() {
  const sku = document.getElementById('change-sku').value;
  const price = document.getElementById('change-price').value;
  const reason = document.getElementById('change-reason').value;
  
  if (!sku || !price) {
    alert('Please enter SKU and price');
    return;
  }
  
  const res = await fetch('/api/v1/changes/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, price, reason })
  });
  
  const data = await res.json();
  if (data.error) {
    alert('Error: ' + data.error);
    return;
  }
  
  document.getElementById('change-sku').value = '';
  document.getElementById('change-price').value = '';
  document.getElementById('change-reason').value = '';
  loadChanges();
}

async function cancelChangeItem(id) {
  if (!confirm('Cancel this change?')) return;
  await fetch(`/api/v1/changes/${id}`, { method: 'DELETE' });
  loadChanges();
}

async function submitChanges() {
  if (!confirm('Submit all pending changes to Amazon?')) return;
  
  const res = await fetch('/api/v1/changes/submit', { method: 'POST' });
  const data = await res.json();
  
  if (data.error) {
    alert('Error: ' + data.error);
  } else if (data.message) {
    alert(data.message);
  } else {
    alert(`Success! Feed ID: ${data.feedId}, ${data.changesSubmitted} changes submitted`);
  }
  loadChanges();
}

// Automation Rules
async function loadRules() {
  try {
    const [rulesRes, templatesRes] = await Promise.all([
      fetch('/api/v1/automation/rules'),
      fetch('/api/v1/automation/templates')
    ]);
    const rulesData = await rulesRes.json();
    const templatesData = await templatesRes.json();
    const rules = rulesData.data?.rules || rulesData.rules || rulesData || [];
    const templates = templatesData.data?.templates || templatesData.templates || templatesData || [];

    // Render active rules
    const rulesEl = document.getElementById('rules-list');
    if (!Array.isArray(rules) || rules.length === 0) {
      rulesEl.innerHTML = '<p class="text-gray-500">No custom rules configured. Use templates below to get started.</p>';
    } else {
      rulesEl.innerHTML = `
        <table class="w-full text-sm">
          <thead><tr class="border-b"><th class="text-left py-2">Name</th><th class="text-left">Trigger</th><th class="text-left">Action</th><th class="text-left">Status</th><th></th></tr></thead>
          <tbody>
            ${rules.map(r => `
              <tr class="border-b">
                <td class="py-2 font-medium">${r.name}</td>
                <td>${r.trigger?.type || 'threshold'} - ${r.trigger?.metric || r.trigger?.event || ''}</td>
                <td>${r.action?.type || 'alert'}</td>
                <td><span class="px-2 py-1 rounded text-xs ${r.enabled !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}">${r.enabled !== false ? 'Active' : 'Disabled'}</span></td>
                <td><button onclick="deleteRule('${r.id}')" class="text-red-600 hover:underline text-xs">Delete</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    
    // Render templates
    const templatesEl = document.getElementById('rule-templates');
    templatesEl.innerHTML = templates.map(t => `
      <div class="border rounded p-4 hover:bg-gray-50">
        <div class="font-medium mb-1">${t.name}</div>
        <div class="text-sm text-gray-600 mb-2">${t.trigger?.type}: ${t.trigger?.metric || t.trigger?.event || ''} ${t.trigger?.operator || ''} ${t.trigger?.value || ''}</div>
        <div class="text-xs text-gray-500 mb-3">Action: ${t.action?.type} (${t.action?.severity})</div>
        <button onclick="enableTemplate('${t.id}')" class="text-blue-600 hover:underline text-sm">Enable This Rule</button>
      </div>
    `).join('');
    
  } catch (e) {
    console.error('Load rules error:', e);
  }
}

async function enableTemplate(templateId) {
  try {
    const templatesRes = await fetch('/api/v1/automation/templates');
    const templatesData = await templatesRes.json();
    const templates = templatesData?.data?.templates || templatesData?.templates || templatesData || [];
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    const rulesRes = await fetch('/api/v1/automation/rules');
    const rulesData = await rulesRes.json();
    const rules = rulesData?.data?.rules || rulesData?.rules || rulesData || [];

    // Check if already exists
    if (rules.some(r => r.id === templateId)) {
      alert('This rule is already enabled');
      return;
    }

    // Add to rules
    rules.push({ ...template, enabled: true });

    await fetch('/api/v1/automation/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules })
    });

    loadRules();
  } catch (e) {
    console.error('Enable template error:', e);
    alert('Failed to enable template: ' + e.message);
  }
}

async function deleteRule(ruleId) {
  if (!confirm('Delete this rule?')) return;

  try {
    const rulesRes = await fetch('/api/v1/automation/rules');
    const rulesData = await rulesRes.json();
    const rules = rulesData?.data?.rules || rulesData?.rules || rulesData || [];
    const filtered = rules.filter(r => r.id !== ruleId);

    await fetch('/api/v1/automation/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: filtered })
    });

    loadRules();
  } catch (e) {
    console.error('Delete rule error:', e);
    alert('Failed to delete rule: ' + e.message);
  }
}

function showAddRule() {
  document.getElementById('add-rule-modal').classList.remove('hidden');
  updateTriggerConfig();
}

function hideAddRule() {
  document.getElementById('add-rule-modal').classList.add('hidden');
}

function updateTriggerConfig() {
  const type = document.getElementById('rule-trigger').value;
  const configEl = document.getElementById('trigger-config');
  
  if (type === 'threshold') {
    configEl.innerHTML = `
      <div class="grid grid-cols-3 gap-2">
        <div><label class="block text-xs mb-1">Metric</label><select id="trigger-metric" class="w-full border rounded px-2 py-1 text-sm"><option value="score">Score</option><option value="margin">Margin %</option><option value="profit">Profit £</option></select></div>
        <div><label class="block text-xs mb-1">Operator</label><select id="trigger-operator" class="w-full border rounded px-2 py-1 text-sm"><option value="lt">Less than</option><option value="gt">Greater than</option></select></div>
        <div><label class="block text-xs mb-1">Value</label><input type="number" id="trigger-value" class="w-full border rounded px-2 py-1 text-sm" value="60"></div>
      </div>
    `;
  } else {
    configEl.innerHTML = `
      <div><label class="block text-xs mb-1">Event</label><select id="trigger-event" class="w-full border rounded px-2 py-1 text-sm"><option value="above_buybox">Price Above Buy Box</option><option value="competitor_undercut">Competitor Undercut</option></select></div>
    `;
  }
}

async function saveRule() {
  const name = document.getElementById('rule-name').value;
  if (!name) { alert('Please enter a rule name'); return; }
  
  const triggerType = document.getElementById('rule-trigger').value;
  const action = document.getElementById('rule-action').value;
  const severity = document.getElementById('rule-severity').value;
  
  let trigger;
  if (triggerType === 'threshold') {
    trigger = {
      type: 'threshold',
      metric: document.getElementById('trigger-metric').value,
      operator: document.getElementById('trigger-operator').value,
      value: parseFloat(document.getElementById('trigger-value').value)
    };
  } else {
    trigger = {
      type: 'competitive',
      event: document.getElementById('trigger-event').value
    };
  }
  
  const rule = {
    id: 'custom_' + Date.now(),
    name,
    trigger,
    action: { type: action, severity },
    enabled: true
  };

  try {
    const rulesRes = await fetch('/api/v1/automation/rules');
    const rulesData = await rulesRes.json();
    const rules = rulesData?.data?.rules || rulesData?.rules || rulesData || [];
    rules.push(rule);

    await fetch('/api/v1/automation/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules })
    });

    hideAddRule();
    loadRules();
  } catch (e) {
    console.error('Save rule error:', e);
    alert('Failed to save rule: ' + e.message);
  }
}

// Add event listener for trigger type change
document.addEventListener('DOMContentLoaded', () => {
  const triggerSelect = document.getElementById('rule-trigger');
  if (triggerSelect) {
    triggerSelect.addEventListener('change', updateTriggerConfig);
  }
});

// ============================================
// BOM & COST MANAGEMENT
// ============================================

let bomSuppliers = [];
let bomComponents = [];
let allBOMs = {};
let currentBOMSku = '';
let allListingsForBOM = [];
let recentlyUsedComponents = [];

// Load recently used components from localStorage
try {
  recentlyUsedComponents = JSON.parse(localStorage.getItem('recentComponents') || '[]');
} catch (e) { recentlyUsedComponents = []; }

async function loadBOMPage() {
  try {
    const [suppliersRes, componentsRes, bomRes, listingsRes] = await Promise.all([
      fetch('/api/v1/suppliers'),
      fetch('/api/v1/components'),
      fetch('/api/v1/bom'),
      fetch('/api/v1/listings')
    ]);

    bomSuppliers = (await suppliersRes.json()).data || [];
    bomComponents = (await componentsRes.json()).data || [];
    allBOMs = (await bomRes.json()).data || {};
    const listingsData = await listingsRes.json();
    allListingsForBOM = listingsData?.data?.items || listingsData?.items || [];

    document.getElementById('bom-suppliers').textContent = bomSuppliers.length;
    document.getElementById('bom-components').textContent = bomComponents.length;
    document.getElementById('bom-skus').textContent = Object.keys(allBOMs).length;

    // Render suppliers
    const suppliersList = document.getElementById('suppliers-list');
    if (bomSuppliers.length === 0) {
      suppliersList.innerHTML = '<p class="text-gray-500 text-sm">No suppliers. Add one to get started.</p>';
    } else {
      suppliersList.innerHTML = bomSuppliers.map(s => `
        <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
          <div><span class="font-medium">${escapeHtml(s.name)}</span><span class="text-xs text-gray-500 ml-2">${escapeHtml(s.email || '')}</span></div>
          <button onclick="deleteSupplier('${s.id}')" class="text-red-500 hover:text-red-700 text-sm">Delete</button>
        </div>
      `).join('');
    }

    // Render components (filtered)
    renderComponentsList();

    // Populate SKU select
    populateSKUSelect();

    // Populate component usage list
    renderComponentUsage(allListingsForBOM);

    // Render recent components buttons
    renderRecentComponents();

    // If we have a SKU selected, refresh it
    if (currentBOMSku) {
      loadBOMForSKU();
    }

  } catch (e) {
    console.error('BOM load error:', e);
  }
}

// Filter and render components list
function renderComponentsList() {
  const componentsList = document.getElementById('components-list');
  const countEl = document.getElementById('components-count');
  const searchTerm = (document.getElementById('component-search')?.value || '').toLowerCase();
  const categoryFilter = document.getElementById('component-category-filter')?.value || '';

  if (bomComponents.length === 0) {
    componentsList.innerHTML = '<p class="text-gray-500 text-sm">No components. Add one to get started.</p>';
    if (countEl) countEl.textContent = '';
    return;
  }

  let filtered = bomComponents;

  // Apply search filter
  if (searchTerm) {
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(searchTerm) ||
      (c.sku || '').toLowerCase().includes(searchTerm) ||
      (c.category || '').toLowerCase().includes(searchTerm)
    );
  }

  // Apply category filter
  if (categoryFilter) {
    filtered = filtered.filter(c => (c.category || 'General') === categoryFilter);
  }

  if (filtered.length === 0) {
    componentsList.innerHTML = '<p class="text-gray-500 text-sm">No matching components.</p>';
    if (countEl) countEl.textContent = `0 of ${bomComponents.length} shown`;
    return;
  }

  // Group by category
  const byCategory = {};
  filtered.forEach(c => {
    const cat = c.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(c);
  });

  let html = '';
  for (const [category, components] of Object.entries(byCategory)) {
    if (!categoryFilter && Object.keys(byCategory).length > 1) {
      html += `<div class="text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-1 rounded mt-2 first:mt-0">${escapeHtml(category)} (${components.length})</div>`;
    }
    html += components.map(c => {
      const supplier = bomSuppliers.find(s => s.id === c.supplierId);
      const usageCount = countComponentUsage(c.id);
      return `
        <div class="flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer component-item" data-id="${c.id}" onclick="quickSelectComponent('${c.id}')">
          <div class="flex-1 min-w-0">
            <span class="font-medium text-sm">${escapeHtml(c.name)}</span>
            <span class="text-xs text-green-600 ml-2">£${safeToFixed(c.unitCost)}</span>
            <span class="text-xs text-gray-400 ml-1">${escapeHtml(supplier?.name || '')}</span>
            ${usageCount > 0 ? `<span class="text-xs bg-blue-100 text-blue-700 px-1 rounded ml-1">×${usageCount}</span>` : ''}
          </div>
          <button onclick="event.stopPropagation(); deleteComponent('${c.id}')" class="text-red-500 hover:text-red-700 text-xs ml-2">Delete</button>
        </div>
      `;
    }).join('');
  }

  componentsList.innerHTML = html;
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${bomComponents.length}`;
}

function filterComponents() {
  renderComponentsList();
}

// Quick select component from list click
function quickSelectComponent(componentId) {
  const select = document.getElementById('bom-add-component');
  if (select) {
    select.value = componentId;
    // Highlight it briefly
    select.classList.add('ring-2', 'ring-green-500');
    setTimeout(() => select.classList.remove('ring-2', 'ring-green-500'), 1000);
  }
}

// Filter SKU dropdown
function populateSKUSelect() {
  const skuSelect = document.getElementById('bom-sku-select');
  const searchTerm = (document.getElementById('bom-sku-search')?.value || '').toLowerCase();

  let filtered = allListingsForBOM;
  if (searchTerm) {
    filtered = filtered.filter(l =>
      (l.sku || '').toLowerCase().includes(searchTerm) ||
      (l.title || '').toLowerCase().includes(searchTerm)
    );
  }

  skuSelect.innerHTML = '<option value="">Select a SKU...</option>' +
    filtered.map(l => `<option value="${escapeHtml(l.sku)}">${escapeHtml(l.sku)} - ${escapeHtml((l.title || '').substring(0, 35))}...</option>`).join('');

  // Preserve selection
  if (currentBOMSku && filtered.some(l => l.sku === currentBOMSku)) {
    skuSelect.value = currentBOMSku;
  }
}

function filterSKUDropdown() {
  populateSKUSelect();
}

// Filter BOM component dropdown with live search suggestions
function filterBOMComponentDropdown() {
  const searchInput = document.getElementById('bom-component-search');
  const suggestionsDiv = document.getElementById('bom-component-suggestions');
  const searchTerm = (searchInput?.value || '').toLowerCase();

  if (!searchTerm || searchTerm.length < 2) {
    suggestionsDiv.classList.add('hidden');
    return;
  }

  const matches = bomComponents.filter(c =>
    c.name.toLowerCase().includes(searchTerm) ||
    (c.sku || '').toLowerCase().includes(searchTerm)
  ).slice(0, 8);

  if (matches.length === 0) {
    suggestionsDiv.innerHTML = '<p class="text-xs text-gray-500 p-2">No matches</p>';
  } else {
    suggestionsDiv.innerHTML = matches.map(c => `
      <div class="p-2 hover:bg-blue-50 cursor-pointer text-sm border-b flex justify-between" onclick="selectComponentFromSearch('${c.id}')">
        <span>${escapeHtml(c.name)}</span>
        <span class="text-green-600">£${safeToFixed(c.unitCost)}</span>
      </div>
    `).join('');
  }
  suggestionsDiv.classList.remove('hidden');
}

function selectComponentFromSearch(componentId) {
  const select = document.getElementById('bom-add-component');
  const searchInput = document.getElementById('bom-component-search');
  const suggestionsDiv = document.getElementById('bom-component-suggestions');

  if (select) select.value = componentId;
  if (searchInput) searchInput.value = '';
  if (suggestionsDiv) suggestionsDiv.classList.add('hidden');

  // Focus qty input
  document.getElementById('bom-add-qty')?.focus();
}

// Render recent components quick-add buttons
function renderRecentComponents() {
  const container = document.getElementById('recent-components');
  if (!container) return;

  const recent = recentlyUsedComponents.slice(0, 5);
  if (recent.length === 0) {
    container.innerHTML = '<span class="text-xs text-gray-400">None yet</span>';
    return;
  }

  container.innerHTML = recent.map(compId => {
    const comp = bomComponents.find(c => c.id === compId);
    if (!comp) return '';
    return `<button onclick="quickAddRecentComponent('${comp.id}')" class="text-xs bg-gray-100 hover:bg-blue-100 px-2 py-1 rounded">${escapeHtml(comp.name.substring(0, 15))}</button>`;
  }).filter(Boolean).join('');
}

function quickAddRecentComponent(componentId) {
  const select = document.getElementById('bom-add-component');
  if (select) {
    select.value = componentId;
    addComponentToBOM();
  }
}

// Track recently used components
function trackRecentComponent(componentId) {
  recentlyUsedComponents = recentlyUsedComponents.filter(id => id !== componentId);
  recentlyUsedComponents.unshift(componentId);
  recentlyUsedComponents = recentlyUsedComponents.slice(0, 10);
  try {
    localStorage.setItem('recentComponents', JSON.stringify(recentlyUsedComponents));
  } catch (e) {}
  renderRecentComponents();
}

// Live cost update
function updateLiveCost() {
  if (!currentBOMSku) return;

  const bom = allBOMs[currentBOMSku] || { components: [] };
  let materialCost = 0;

  for (const bomItem of bom.components || []) {
    const component = bomComponents.find(c => c.id === bomItem.componentId);
    if (component) {
      materialCost += (component.unitCost || 0) * (bomItem.quantity || 1);
    }
  }

  const laborCost = parseFloat(document.getElementById('bom-labor')?.value) || 0;
  const packagingCost = parseFloat(document.getElementById('bom-packaging')?.value) || 0;
  const overheadPercent = parseFloat(document.getElementById('bom-overhead')?.value) || 0;

  const subtotal = materialCost + laborCost + packagingCost;
  const overheadCost = subtotal * (overheadPercent / 100);
  const total = subtotal + overheadCost;

  const breakdownEl = document.getElementById('bom-cost-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = `
      <div class="flex justify-between text-sm"><span>Materials:</span><span>£${safeToFixed(materialCost)}</span></div>
      <div class="flex justify-between text-sm"><span>Labor:</span><span>£${safeToFixed(laborCost)}</span></div>
      <div class="flex justify-between text-sm"><span>Packaging:</span><span>£${safeToFixed(packagingCost)}</span></div>
      <div class="flex justify-between text-sm"><span>Overhead:</span><span>£${safeToFixed(overheadCost)}</span></div>
      <div class="flex justify-between font-bold border-t pt-2 mt-2"><span>Total:</span><span class="text-green-600">£${safeToFixed(total)}</span></div>
    `;
  }

  // Show comparison if we have a selling price
  const listing = allListingsForBOM.find(l => l.sku === currentBOMSku);
  const comparisonEl = document.getElementById('cost-comparison');
  if (comparisonEl && listing?.price) {
    const price = parseFloat(listing.price) || 0;
    const margin = price > 0 ? ((price - total) / price * 100) : 0;
    const profit = price - total;
    comparisonEl.innerHTML = `
      Selling: £${safeToFixed(price)} | Profit: <span class="${profit > 0 ? 'text-green-600' : 'text-red-600'}">£${safeToFixed(profit)}</span> (${safeToFixed(margin, 1)}%)
    `;
  }
}

// Filter usage list
function filterUsageList() {
  const searchTerm = (document.getElementById('usage-search')?.value || '').toLowerCase();
  const items = document.querySelectorAll('#component-usage-list > div');

  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(searchTerm) ? '' : 'none';
  });
}

function countComponentUsage(componentId) {
  let count = 0;
  for (const sku in allBOMs) {
    const bom = allBOMs[sku];
    if (bom.components && bom.components.some(c => c.componentId === componentId)) {
      count++;
    }
  }
  return count;
}

function renderComponentUsage(listings) {
  const usageList = document.getElementById('component-usage-list');

  if (bomComponents.length === 0) {
    usageList.innerHTML = '<p class="text-gray-500 text-sm col-span-2">No components created yet.</p>';
    return;
  }

  const usageData = bomComponents.map(comp => {
    const usedIn = [];
    for (const sku in allBOMs) {
      const bom = allBOMs[sku];
      const bomComp = bom.components?.find(c => c.componentId === comp.id);
      if (bomComp) {
        const listing = listings.find(l => l.sku === sku);
        usedIn.push({
          sku,
          title: listing?.title || sku,
          quantity: bomComp.quantity
        });
      }
    }
    return { component: comp, usedIn };
  }).filter(item => item.usedIn.length > 0);

  if (usageData.length === 0) {
    usageList.innerHTML = '<p class="text-gray-500 text-sm col-span-2">No components are assigned to any BOMs yet. Select a SKU above and add components to its BOM.</p>';
    return;
  }

  usageList.innerHTML = usageData.map(item => `
    <div class="p-3 bg-gray-50 rounded border">
      <div class="font-medium text-sm">${item.component.name}</div>
      <div class="text-xs text-gray-500 mb-2">£${(parseFloat(item.component?.unitCost)||0).toFixed(2)} per unit</div>
      <div class="space-y-1">
        ${item.usedIn.map(u => `
          <div class="text-xs flex justify-between">
            <span class="truncate flex-1" title="${u.title}">${u.sku}</span>
            <span class="text-gray-500 ml-2">×${u.quantity}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function showSupplierModal() {
  const name = prompt('Supplier Name:');
  if (!name) return;
  const email = prompt('Email (optional):');

  await fetch('/api/v1/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email })
  });

  loadBOMPage();
}

async function deleteSupplier(id) {
  if (!confirm('Delete this supplier?')) return;
  await fetch('/api/v1/suppliers/' + id, { method: 'DELETE' });
  loadBOMPage();
}

async function showComponentModal() {
  const name = prompt('Component Name:');
  if (!name) return;
  const unitCost = prompt('Unit Cost (£):', '0.00');

  const supplierSelect = bomSuppliers.length > 0 ?
    prompt('Supplier ID (leave blank for none):\n' + bomSuppliers.map(s => s.id + ' = ' + s.name).join('\n')) : '';

  await fetch('/api/v1/components', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, unitCost: parseFloat(unitCost) || 0, supplierId: supplierSelect || null })
  });

  loadBOMPage();
}

async function deleteComponent(id) {
  if (!confirm('Delete this component?')) return;
  await fetch('/api/v1/components/' + id, { method: 'DELETE' });
  loadBOMPage();
}

async function loadBOMForSKU() {
  const sku = document.getElementById('bom-sku-select').value;
  if (!sku) {
    document.getElementById('bom-editor').classList.add('hidden');
    return;
  }

  currentBOMSku = sku;
  document.getElementById('bom-editor').classList.remove('hidden');

  try {
    const res = await fetch('/api/v1/bom/' + encodeURIComponent(sku));
    const { data } = await res.json();
    const bom = data.bom;
    const cost = data.landedCost;

    document.getElementById('bom-labor').value = bom.laborCost || 0;
    document.getElementById('bom-packaging').value = bom.packagingCost || 0;
    document.getElementById('bom-overhead').value = bom.overheadPercent || 0;

    // Get list of component IDs already in this BOM
    const usedComponentIds = (bom.components || []).map(c => c.componentId);

    // Update component count
    const countEl = document.getElementById('bom-component-count');
    if (countEl) countEl.textContent = `(${cost.componentDetails.length} items)`;

    // Populate add-component dropdown with available components
    const addCompSelect = document.getElementById('bom-add-component');
    addCompSelect.innerHTML = '<option value="">Or select from list...</option>' +
      bomComponents.map(c => {
        const inUse = usedComponentIds.includes(c.id);
        return `<option value="${c.id}" ${inUse ? 'disabled' : ''}>${escapeHtml(c.name)} - £${safeToFixed(c.unitCost)}${inUse ? ' (already added)' : ''}</option>`;
      }).join('');

    // Render components in BOM with remove buttons
    const compList = document.getElementById('bom-components-list');
    if (cost.componentDetails.length === 0) {
      compList.innerHTML = '<p class="text-gray-500 text-sm">No components added yet. Use the dropdown to add components.</p>';
    } else {
      compList.innerHTML = cost.componentDetails.map(c => `
        <div class="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
          <div>
            <span class="font-medium">${escapeHtml(c.name)}</span>
            <span class="text-gray-500 ml-1">×${c.quantity}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-gray-600">£${safeToFixed(c.totalCost)}</span>
            <button onclick="removeComponentFromBOM('${c.componentId}')" class="text-red-500 hover:text-red-700 text-xs">✕</button>
          </div>
        </div>
      `).join('');
    }

    // Update live cost and store BOM in memory for live updates
    allBOMs[currentBOMSku] = bom;
    updateLiveCost();
  } catch (e) {
    console.error('BOM load error:', e);
  }
}

async function addComponentToBOM() {
  if (!currentBOMSku) {
    alert('Please select a SKU first');
    return;
  }

  const componentId = document.getElementById('bom-add-component').value;
  const quantity = parseInt(document.getElementById('bom-add-qty').value) || 1;

  if (!componentId) {
    alert('Please select a component to add');
    return;
  }

  try {
    await fetch(`/api/v1/bom/${encodeURIComponent(currentBOMSku)}/component`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentId, quantity })
    });

    // Track recently used component
    trackRecentComponent(componentId);

    // Reset the form
    document.getElementById('bom-add-component').value = '';
    document.getElementById('bom-add-qty').value = '1';
    const searchInput = document.getElementById('bom-component-search');
    if (searchInput) searchInput.value = '';

    // Reload the BOM view
    loadBOMForSKU();
    loadBOMPage(); // Refresh usage counts
  } catch (e) {
    alert('Error adding component: ' + e.message);
  }
}

async function removeComponentFromBOM(componentId) {
  if (!currentBOMSku) return;

  if (!confirm('Remove this component from the BOM?')) return;

  try {
    await fetch(`/api/v1/bom/${encodeURIComponent(currentBOMSku)}/component/${componentId}`, {
      method: 'DELETE'
    });

    loadBOMForSKU();
    loadBOMPage(); // Refresh usage counts
  } catch (e) {
    alert('Error removing component: ' + e.message);
  }
}

// ============================================
// ECONOMICS PANEL (v2 API) - DATA_CONTRACTS.md compliant
// ============================================

/**
 * Load economics data for a listing using the v2 API
 * Returns economics DTO per DATA_CONTRACTS.md §4
 */
async function loadEconomicsV2(listingId) {
  try {
    const res = await fetch(`/api/v2/listings/${listingId}/economics`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load economics');
    }
    return await res.json();
  } catch (e) {
    console.error('Economics load error:', e);
    return null;
  }
}

/**
 * Render economics panel HTML
 * @param {Object} econ - Economics DTO from v2 API
 * @returns {string} HTML string
 */
function renderEconomicsPanel(econ) {
  if (!econ || econ.error) {
    return `<div class="p-4 bg-red-50 text-red-600 rounded">Unable to load economics data</div>`;
  }

  const profitColor = econ.profit_ex_vat >= 0 ? 'text-green-600' : 'text-red-600';
  const marginPct = (econ.margin * 100).toFixed(1);
  const vatPct = (econ.vat_rate * 100).toFixed(0);

  return `
    <div class="bg-white border rounded-lg p-4 mb-4">
      <h3 class="font-semibold text-lg mb-3 flex items-center">
        <span class="mr-2">📊</span> Economics (VAT ${vatPct}%)
      </h3>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="bg-gray-50 p-3 rounded">
          <p class="text-xs text-gray-500">Price (inc VAT)</p>
          <p class="font-bold text-lg">£${safeToFixed(econ.price_inc_vat)}</p>
        </div>
        <div class="bg-gray-50 p-3 rounded">
          <p class="text-xs text-gray-500">Price (ex VAT)</p>
          <p class="font-bold text-lg">£${safeToFixed(econ.price_ex_vat)}</p>
        </div>
        <div class="bg-${econ.profit_ex_vat >= 0 ? 'green' : 'red'}-50 p-3 rounded">
          <p class="text-xs text-gray-500">Profit (ex VAT)</p>
          <p class="font-bold text-lg ${profitColor}">£${safeToFixed(econ.profit_ex_vat)}</p>
        </div>
        <div class="bg-${econ.margin >= 0.15 ? 'green' : econ.margin >= 0 ? 'yellow' : 'red'}-50 p-3 rounded">
          <p class="text-xs text-gray-500">Margin</p>
          <p class="font-bold text-lg">${marginPct}%</p>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <div class="bg-gray-50 p-2 rounded text-center">
          <p class="text-xs text-gray-500">BOM Cost</p>
          <p class="font-semibold">£${safeToFixed(econ.bom_cost_ex_vat)}</p>
        </div>
        <div class="bg-gray-50 p-2 rounded text-center">
          <p class="text-xs text-gray-500">Shipping</p>
          <p class="font-semibold">£${safeToFixed(econ.shipping_cost_ex_vat)}</p>
        </div>
        <div class="bg-gray-50 p-2 rounded text-center">
          <p class="text-xs text-gray-500">Packaging</p>
          <p class="font-semibold">£${safeToFixed(econ.packaging_cost_ex_vat)}</p>
        </div>
        <div class="bg-gray-50 p-2 rounded text-center">
          <p class="text-xs text-gray-500">Amazon Fees</p>
          <p class="font-semibold">£${safeToFixed(econ.amazon_fees_ex_vat)}</p>
        </div>
        <div class="bg-gray-100 p-2 rounded text-center">
          <p class="text-xs text-gray-500">Total Cost</p>
          <p class="font-semibold">£${safeToFixed(econ.total_cost_ex_vat)}</p>
        </div>
      </div>

      <div class="mt-3 pt-3 border-t flex justify-between text-sm text-gray-600">
        <span>Break-even: £${safeToFixed(econ.break_even_price_inc_vat)} inc VAT</span>
        <span>BOM v${econ.bom_version || '-'}</span>
      </div>
    </div>
  `;
}

/**
 * Preview price change economics
 * @param {number} listingId
 * @param {number} newPriceIncVat
 */
async function previewPriceChangeV2(listingId, newPriceIncVat) {
  try {
    const res = await fetch(`/api/v2/listings/${listingId}/price/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_inc_vat: newPriceIncVat })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Preview failed');
    }
    return await res.json();
  } catch (e) {
    console.error('Price preview error:', e);
    return null;
  }
}

/**
 * Render price change preview comparison
 * @param {Object} preview - { current, proposed, diff }
 * @returns {string} HTML string
 */
function renderPricePreview(preview) {
  if (!preview) {
    return `<div class="p-4 bg-red-50 text-red-600 rounded">Unable to preview price change</div>`;
  }

  const { current, proposed, diff } = preview;
  const profitChangeColor = diff.profit_ex_vat >= 0 ? 'text-green-600' : 'text-red-600';
  const profitChangeSign = diff.profit_ex_vat >= 0 ? '+' : '';

  return `
    <div class="bg-white border rounded-lg p-4">
      <h4 class="font-semibold mb-3">Price Change Preview</h4>

      <div class="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p class="text-xs text-gray-500 mb-1">Current</p>
          <p class="font-semibold">£${safeToFixed(current.price_inc_vat)}</p>
          <p class="text-gray-600">Profit: £${safeToFixed(current.profit_ex_vat)}</p>
          <p class="text-gray-600">Margin: ${(current.margin * 100).toFixed(1)}%</p>
        </div>

        <div class="flex items-center justify-center">
          <span class="text-2xl text-gray-400">→</span>
        </div>

        <div>
          <p class="text-xs text-gray-500 mb-1">Proposed</p>
          <p class="font-semibold">£${safeToFixed(proposed.price_inc_vat)}</p>
          <p class="${profitChangeColor}">Profit: £${safeToFixed(proposed.profit_ex_vat)}</p>
          <p class="${diff.margin >= 0 ? 'text-green-600' : 'text-red-600'}">Margin: ${(proposed.margin * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div class="mt-3 pt-3 border-t text-sm">
        <span class="${profitChangeColor} font-semibold">
          ${profitChangeSign}£${safeToFixed(diff.profit_ex_vat)} profit change
        </span>
        <span class="text-gray-500 ml-2">
          (${profitChangeSign}${(diff.margin * 100).toFixed(1)}% margin)
        </span>
      </div>
    </div>
  `;
}

async function saveBOMData() {
  if (!currentBOMSku) return;

  try {
    const res = await fetch('/api/v1/bom/' + encodeURIComponent(currentBOMSku), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        laborCost: parseFloat(document.getElementById('bom-labor').value) || 0,
        packagingCost: parseFloat(document.getElementById('bom-packaging').value) || 0,
        overheadPercent: parseFloat(document.getElementById('bom-overhead').value) || 0
      })
    });

    const data = await res.json();
    if (data.success) {
      loadBOMForSKU();
      alert('BOM saved!');
    } else {
      alert('Error saving BOM: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Error saving BOM: ' + e.message);
  }
}

// ============================================
// OPPORTUNITIES
// ============================================

async function loadOpportunities() {
  try {
    const [oppRes, quickRes, bundleRes, seasonalRes] = await Promise.all([
      fetch('/api/v1/opportunities'),
      fetch('/api/v1/opportunities/quick-wins'),
      fetch('/api/v1/opportunities/bundles'),
      fetch('/api/v1/opportunities/seasonal')
    ]);

    const oppData = await oppRes.json();
    const quickWins = (await quickRes.json()).data || [];
    const bundles = (await bundleRes.json()).data || [];
    const seasonal = (await seasonalRes.json()).data || {};

    const { opportunities, summary } = oppData.data || { opportunities: [], summary: {} };

    // Update stats
    document.getElementById('opp-total').textContent = summary.totalOpportunities || 0;
    document.getElementById('opp-quickwins').textContent = summary.totalQuickWins || 0;
    document.getElementById('opp-high').textContent = summary.totalHighPriority || 0;
    document.getElementById('opp-avg').textContent = summary.averageOpportunityScore || 0;

    // Render quick wins
    const quickList = document.getElementById('quick-wins-list');
    if (quickWins.length === 0) {
      quickList.innerHTML = '<p class="text-gray-500 text-sm">No quick wins found.</p>';
    } else {
      quickList.innerHTML = quickWins.map(q => `
        <div class="p-3 bg-green-50 rounded border border-green-200">
          <div class="font-medium text-sm">${q.sku}</div>
          <div class="text-xs text-gray-600 mb-1">${q.opportunityTitle}</div>
          <div class="text-xs text-green-700">${q.estimatedImpact}</div>
          <div class="text-xs text-gray-500 mt-1">Actions: ${q.actions.join(', ')}</div>
        </div>
      `).join('');
    }

    // Render bundles
    const bundleList = document.getElementById('bundles-list');
    if (bundles.length === 0) {
      bundleList.innerHTML = '<p class="text-gray-500 text-sm">No bundle opportunities found.</p>';
    } else {
      bundleList.innerHTML = bundles.slice(0, 10).map(b => `
        <div class="p-3 bg-blue-50 rounded border border-blue-200">
          <div class="text-sm font-medium">${b.category} Bundle</div>
          <div class="text-xs text-gray-600">${b.items.map(i => i.sku).join(' + ')}</div>
          <div class="text-xs mt-1">Combined: £${(parseFloat(b.combinedPrice)||0).toFixed(2)} → Bundle: £${(parseFloat(b.suggestedBundlePrice)||0).toFixed(2)}</div>
          <div class="text-xs text-green-600">Save £${(parseFloat(b.savings)||0).toFixed(2)}</div>
        </div>
      `).join('');
    }

    // Render seasonal
    document.getElementById('seasonal-info').innerHTML = `
      <div class="flex gap-4 text-sm">
        <span class="bg-blue-100 px-3 py-1 rounded">Current: ${seasonal.currentSeasons?.join(', ') || 'N/A'}</span>
        <span class="bg-purple-100 px-3 py-1 rounded">Upcoming: ${seasonal.upcomingSeasons?.join(', ') || 'N/A'}</span>
      </div>
    `;

    const seasonalList = document.getElementById('seasonal-list');
    const seasonalItems = seasonal.seasonalListings || [];
    if (seasonalItems.length === 0) {
      seasonalList.innerHTML = '<p class="text-gray-500 text-sm">No seasonal items detected.</p>';
    } else {
      seasonalList.innerHTML = seasonalItems.slice(0, 10).map(s => `
        <div class="p-2 bg-yellow-50 rounded text-sm">
          <span class="font-medium">${s.sku}</span>
          <span class="text-xs text-gray-500 ml-2">Keywords: ${s.matchedKeywords.join(', ')}</span>
        </div>
      `).join('');
    }

    // Render all opportunities
    const oppList = document.getElementById('opportunities-list');
    if (opportunities.length === 0) {
      oppList.innerHTML = '<p class="text-gray-500 text-sm">No opportunities found. Sync your listings first.</p>';
    } else {
      oppList.innerHTML = opportunities.slice(0, 30).map(o => `
        <div class="p-3 border rounded">
          <div class="flex justify-between items-start mb-2">
            <div><span class="font-medium">${o.sku}</span><span class="text-xs text-gray-500 ml-2">Score: ${o.currentScore}/100</span></div>
            <span class="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Opp Score: ${o.opportunityScore}</span>
          </div>
          <div class="text-xs text-gray-600 mb-2">${(o.title || '').substring(0, 60)}...</div>
          <div class="flex flex-wrap gap-1">
            ${o.opportunities.map(op => `<span class="text-xs px-2 py-0.5 rounded ${op.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">${op.title}</span>`).join('')}
          </div>
        </div>
      `).join('');
    }

  } catch (e) {
    console.error('Opportunities error:', e);
  }
}

// ============================================
// FORECASTING
// ============================================

let forecastListings = [];

async function loadBulkForecast() {
  try {
    const [forecastRes, listingsRes] = await Promise.all([
      fetch('/api/v1/forecast/bulk'),
      fetch('/api/v1/listings')
    ]);

    const forecastData = (await forecastRes.json()).data || {};
    forecastListings = (await listingsRes.json()).data?.items || [];

    document.getElementById('fc-with-data').textContent = forecastData.skusWithData || 0;
    document.getElementById('fc-growing').textContent = forecastData.growing || 0;
    document.getElementById('fc-stable').textContent = forecastData.stable || 0;
    document.getElementById('fc-declining').textContent = forecastData.declining || 0;

    // Render top sellers
    const topList = document.getElementById('top-sellers-list');
    const topSellers = forecastData.topSellers || [];
    if (topSellers.length === 0) {
      topList.innerHTML = '<p class="text-gray-500 text-sm">No forecast data. Need sales history to forecast.</p>';
    } else {
      topList.innerHTML = topSellers.map(t => `
        <div class="flex justify-between items-center p-2 ${t.trend === 'growing' ? 'bg-green-50' : t.trend === 'declining' ? 'bg-red-50' : 'bg-gray-50'} rounded">
          <span class="font-medium text-sm">${t.sku}</span>
          <div class="text-right">
            <span class="text-sm">${t.total} units</span>
            <span class="text-xs ml-2 ${t.trend === 'growing' ? 'text-green-600' : t.trend === 'declining' ? 'text-red-600' : 'text-gray-500'}">${t.trend}</span>
          </div>
        </div>
      `).join('');
    }

    // Populate SKU select
    const skuSelect = document.getElementById('forecast-sku-select');
    skuSelect.innerHTML = '<option value="">Select a SKU...</option>' +
      forecastListings.map(l => `<option value="${l.sku}">${l.sku}</option>`).join('');

  } catch (e) {
    console.error('Forecast error:', e);
  }
}

async function loadSKUForecast() {
  const sku = document.getElementById('forecast-sku-select').value;
  const detail = document.getElementById('forecast-detail');

  if (!sku) {
    detail.innerHTML = '';
    return;
  }

  try {
    const res = await fetch('/api/v1/forecast/' + sku + '?days=14');
    const { data } = await res.json();

    if (!data.hasEnoughData) {
      detail.innerHTML = `<p class="text-yellow-600 text-sm">${data.message}</p>`;
      return;
    }

    detail.innerHTML = `
      <div class="space-y-2">
        <div class="flex justify-between text-sm"><span>Daily Avg:</span><span>${data.insights.recentDailyAvg} units</span></div>
        <div class="flex justify-between text-sm"><span>Trend:</span><span class="${data.insights.trend === 'growing' ? 'text-green-600' : data.insights.trend === 'declining' ? 'text-red-600' : ''}">${data.insights.trend} (${data.insights.growthRate}%)</span></div>
        <div class="flex justify-between text-sm"><span>14-Day Forecast:</span><span>${data.summary.totalPredictedUnits} units</span></div>
        <div class="flex justify-between text-sm"><span>Confidence:</span><span>${data.summary.confidence}</span></div>
        <div class="mt-3 pt-3 border-t">
          <div class="text-xs text-gray-500 mb-2">Next 7 Days:</div>
          ${data.forecast.slice(0, 7).map(f => `
            <div class="flex justify-between text-xs py-1 border-b border-gray-100">
              <span>${f.date} (${f.dayOfWeek})</span>
              <span>${f.predictedUnits} (${f.lowEstimate}-${f.highEstimate})</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    detail.innerHTML = '<p class="text-red-500 text-sm">Error loading forecast</p>';
  }
}

async function checkRestock() {
  const sku = document.getElementById('forecast-sku-select').value;
  const stock = document.getElementById('restock-stock').value;
  const leadTime = document.getElementById('restock-lead').value;
  const result = document.getElementById('restock-result');

  if (!sku) {
    result.innerHTML = '<p class="text-yellow-600">Select a SKU first</p>';
    return;
  }

  try {
    const res = await fetch(`/api/v1/forecast/${sku}/restock?stock=${stock}&leadTime=${leadTime}&safety=7`);
    const { data } = await res.json();

    if (data.recommendation === 'insufficient_data') {
      result.innerHTML = `<p class="text-yellow-600">${data.message}</p>`;
      return;
    }

    const urgencyColors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300',
      none: 'bg-green-100 text-green-800 border-green-300'
    };

    result.innerHTML = `
      <div class="p-4 rounded border ${urgencyColors[data.urgency] || 'bg-gray-100'}">
        <div class="font-bold mb-2">${data.recommendation.replace(/_/g, ' ').toUpperCase()}</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>Current Stock: ${data.currentStock}</div>
          <div>Reorder Point: ${data.reorderPoint}</div>
          <div>Days Until Stockout: ${data.daysUntilStockout}</div>
          <div>Suggested Order: ${data.suggestedQuantity} units</div>
        </div>
        <div class="mt-2 text-xs text-gray-600">
          Lead time demand: ${data.demandForecast.leadTimeDemand} |
          Safety stock: ${data.demandForecast.safetyStockDemand} |
          Confidence: ${data.confidence}
        </div>
      </div>
    `;
  } catch (e) {
    result.innerHTML = '<p class="text-red-500">Error checking restock</p>';
  }
}

// ============================================
// REPORTS
// ============================================

async function loadReportsPage() {
  try {
    const [templatesRes, scheduledRes, recentRes] = await Promise.all([
      fetch('/api/v1/reports/templates'),
      fetch('/api/v1/reports/scheduled'),
      fetch('/api/v1/reports/recent')
    ]);

    const templates = (await templatesRes.json()).data || [];
    const scheduled = (await scheduledRes.json()).data || [];
    const recent = (await recentRes.json()).data || [];

    document.getElementById('rpt-generated').textContent = recent.length;
    document.getElementById('rpt-scheduled').textContent = scheduled.length;
    document.getElementById('rpt-last').textContent = recent.length > 0 ?
      new Date(recent[0].generatedAt).toLocaleString() : 'Never';

    // Render templates
    const templatesList = document.getElementById('report-templates-list');
    templatesList.innerHTML = templates.map(t => `
      <div class="p-3 bg-gray-50 rounded border hover:bg-gray-100">
        <div class="flex justify-between items-start">
          <div>
            <div class="font-medium">${t.name}</div>
            <div class="text-xs text-gray-500">${t.description}</div>
          </div>
          <button onclick="quickGenerateReport('${t.id}')" class="text-blue-600 hover:underline text-sm">Generate</button>
        </div>
      </div>
    `).join('');

    // Render scheduled reports
    const scheduledList = document.getElementById('scheduled-reports-list');
    if (scheduled.length === 0) {
      scheduledList.innerHTML = '<p class="text-gray-500 text-sm">No scheduled reports.</p>';
    } else {
      scheduledList.innerHTML = scheduled.map(s => `
        <div class="p-3 bg-blue-50 rounded border border-blue-200">
          <div class="flex justify-between items-start">
            <div>
              <div class="font-medium">${s.name}</div>
              <div class="text-xs text-gray-500">${s.schedule.frequency} - ${s.format}</div>
              <div class="text-xs text-gray-400">Next: ${s.schedule.nextRun ? new Date(s.schedule.nextRun).toLocaleString() : 'N/A'}</div>
            </div>
            <button onclick="deleteScheduledReport('${s.id}')" class="text-red-500 hover:text-red-700 text-sm">Delete</button>
          </div>
        </div>
      `).join('');
    }

    // Render recent reports
    const recentList = document.getElementById('recent-reports-list');
    if (recent.length === 0) {
      recentList.innerHTML = '<p class="text-gray-500 text-sm">No reports generated yet.</p>';
    } else {
      recentList.innerHTML = recent.slice(0, 20).map(r => `
        <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
          <div>
            <span class="font-medium text-sm">${r.templateId}</span>
            <span class="text-xs text-gray-500 ml-2">${r.format}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">${new Date(r.generatedAt).toLocaleString()}</span>
            <button onclick="downloadReport('${r.id}')" class="text-blue-600 hover:underline text-xs">Download</button>
          </div>
        </div>
      `).join('');
    }

  } catch (e) {
    console.error('Reports load error:', e);
  }
}

function showGenerateReportModal() {
  document.getElementById('generate-report-modal').classList.remove('hidden');
  document.getElementById('report-schedule').addEventListener('change', function() {
    document.getElementById('schedule-options').classList.toggle('hidden', !this.checked);
  });
}

function hideGenerateReportModal() {
  document.getElementById('generate-report-modal').classList.add('hidden');
}

async function generateReport() {
  const templateId = document.getElementById('report-template').value;
  const format = document.getElementById('report-format').value;
  const shouldSchedule = document.getElementById('report-schedule').checked;

  try {
    if (shouldSchedule) {
      const frequency = document.getElementById('report-frequency').value;
      await fetch('/api/v1/reports/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Scheduled ${templateId}`,
          templateId,
          format,
          schedule: { frequency }
        })
      });
      alert('Report scheduled successfully!');
    } else {
      const res = await fetch('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, format })
      });
      const data = await res.json();

      if (format === 'html') {
        const newWindow = window.open('', '_blank');
        newWindow.document.write(data.data.content);
      } else if (format === 'csv') {
        const blob = new Blob([data.data.content], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${templateId}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
      } else {
        alert('Report generated! Check recent reports to download.');
      }
    }

    hideGenerateReportModal();
    loadReportsPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function quickGenerateReport(templateId) {
  const format = prompt('Output format (json, csv, html):', 'html');
  if (!format) return;

  try {
    const res = await fetch('/api/v1/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, format })
    });
    const data = await res.json();

    if (format === 'html') {
      const newWindow = window.open('', '_blank');
      newWindow.document.write(data.data.content);
    } else if (format === 'csv') {
      const blob = new Blob([data.data.content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateId}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } else {
      console.log('Report data:', data.data);
      alert('Report generated in JSON format. Check console for data.');
    }

    loadReportsPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteScheduledReport(id) {
  if (!confirm('Delete this scheduled report?')) return;
  await fetch('/api/v1/reports/scheduled/' + id, { method: 'DELETE' });
  loadReportsPage();
}

async function downloadReport(id) {
  try {
    const res = await fetch('/api/v1/reports/' + id);
    const data = await res.json();
    console.log('Report:', data);
    alert('Report data logged to console.');
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ============================================
// WEBHOOKS
// ============================================

async function loadWebhooksPage() {
  try {
    const [webhooksRes, executionsRes] = await Promise.all([
      fetch('/api/v1/webhooks'),
      fetch('/api/v1/webhooks/executions')
    ]);

    const webhooks = (await webhooksRes.json()).data || [];
    const executions = (await executionsRes.json()).data || [];

    const active = webhooks.filter(w => w.enabled !== false).length;
    const recentExecs = executions.filter(e => new Date(e.executedAt) > new Date(Date.now() - 24*60*60*1000));
    const failures = recentExecs.filter(e => !e.success).length;

    document.getElementById('wh-total').textContent = webhooks.length;
    document.getElementById('wh-active').textContent = active;
    document.getElementById('wh-executions').textContent = recentExecs.length;
    document.getElementById('wh-failures').textContent = failures;

    // Render webhooks
    const webhooksList = document.getElementById('webhooks-list');
    if (webhooks.length === 0) {
      webhooksList.innerHTML = '<p class="text-gray-500 text-sm">No webhooks configured. Add one to get started.</p>';
    } else {
      webhooksList.innerHTML = webhooks.map(w => `
        <div class="p-4 border rounded ${w.enabled !== false ? 'bg-white' : 'bg-gray-100 opacity-75'}">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="font-medium">${w.name}</div>
              <div class="text-xs text-gray-500 font-mono truncate">${w.url}</div>
              <div class="flex gap-2 mt-2">
                ${w.events.map(e => `<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">${e}</span>`).join('')}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="toggleWebhook('${w.id}')" class="text-sm ${w.enabled !== false ? 'text-yellow-600' : 'text-green-600'}">${w.enabled !== false ? 'Disable' : 'Enable'}</button>
              <button onclick="testWebhook('${w.id}')" class="text-blue-600 text-sm">Test</button>
              <button onclick="deleteWebhook('${w.id}')" class="text-red-500 text-sm">Delete</button>
            </div>
          </div>
        </div>
      `).join('');
    }

    // Render executions
    const execList = document.getElementById('webhook-executions-list');
    if (executions.length === 0) {
      execList.innerHTML = '<p class="text-gray-500 text-sm">No webhook executions yet.</p>';
    } else {
      execList.innerHTML = executions.slice(0, 20).map(e => `
        <div class="flex justify-between items-center p-2 ${e.success ? 'bg-green-50' : 'bg-red-50'} rounded">
          <div>
            <span class="font-medium text-sm">${e.webhookName || e.webhookId}</span>
            <span class="text-xs text-gray-500 ml-2">${e.event}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs ${e.success ? 'text-green-600' : 'text-red-600'}">${e.success ? 'Success' : 'Failed'} (${e.statusCode || 'N/A'})</span>
            <span class="text-xs text-gray-400">${new Date(e.executedAt).toLocaleString()}</span>
          </div>
        </div>
      `).join('');
    }

  } catch (e) {
    console.error('Webhooks load error:', e);
  }
}

function showAddWebhookModal() {
  document.getElementById('add-webhook-modal').classList.remove('hidden');
}

function hideAddWebhookModal() {
  document.getElementById('add-webhook-modal').classList.add('hidden');
  document.getElementById('wh-name').value = '';
  document.getElementById('wh-url').value = '';
  document.querySelectorAll('.wh-event').forEach(c => c.checked = false);
  document.getElementById('wh-auth-type').value = 'none';
  document.getElementById('wh-auth-config').classList.add('hidden');
}

function toggleWebhookAuth() {
  const authType = document.getElementById('wh-auth-type').value;
  const configDiv = document.getElementById('wh-auth-config');
  configDiv.classList.toggle('hidden', authType === 'none');
}

async function saveWebhook() {
  const name = document.getElementById('wh-name').value;
  const url = document.getElementById('wh-url').value;
  const events = Array.from(document.querySelectorAll('.wh-event:checked')).map(c => c.value);
  const authType = document.getElementById('wh-auth-type').value;
  const authValue = document.getElementById('wh-auth-value').value;

  if (!name || !url) {
    alert('Please enter name and URL');
    return;
  }

  if (events.length === 0) {
    alert('Please select at least one event');
    return;
  }

  const webhook = { name, url, events };
  if (authType !== 'none') {
    webhook.auth = { type: authType, value: authValue };
  }

  try {
    await fetch('/api/v1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhook)
    });

    hideAddWebhookModal();
    loadWebhooksPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function toggleWebhook(id) {
  try {
    await fetch('/api/v1/webhooks/' + id + '/toggle', { method: 'POST' });
    loadWebhooksPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function testWebhook(id) {
  try {
    const res = await fetch('/api/v1/webhooks/' + id + '/test', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert('Webhook test successful! Status: ' + data.data.statusCode);
    } else {
      alert('Webhook test failed: ' + (data.error || 'Unknown error'));
    }
    loadWebhooksPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteWebhook(id) {
  if (!confirm('Delete this webhook?')) return;
  await fetch('/api/v1/webhooks/' + id, { method: 'DELETE' });
  loadWebhooksPage();
}

// ============================================
// DASHBOARD WIDGETS
// ============================================

let widgetTypes = [];
let activeLayout = { widgets: [] };

async function loadWidgetsPage() {
  try {
    const [typesRes, layoutRes, layoutsRes] = await Promise.all([
      fetch('/api/v1/widgets/types'),
      fetch('/api/v1/widgets/layout'),
      fetch('/api/v1/widgets/layouts')
    ]);

    widgetTypes = (await typesRes.json()).data || [];
    activeLayout = (await layoutRes.json()).data || { widgets: [] };
    const savedLayouts = (await layoutsRes.json()).data || [];

    // Render available widgets
    const availableList = document.getElementById('available-widgets');
    availableList.innerHTML = widgetTypes.map(w => {
      const isActive = activeLayout.widgets.some(aw => aw.type === w.id);
      return `
        <div class="p-3 border rounded ${isActive ? 'bg-green-50 border-green-200' : 'bg-gray-50'}">
          <div class="flex justify-between items-center">
            <div>
              <div class="font-medium text-sm">${w.name}</div>
              <div class="text-xs text-gray-500">${w.description || ''}</div>
            </div>
            <button onclick="toggleWidget('${w.id}')" class="text-sm ${isActive ? 'text-red-600' : 'text-green-600'}">${isActive ? 'Remove' : 'Add'}</button>
          </div>
        </div>
      `;
    }).join('');

    // Render active widgets
    const activeList = document.getElementById('active-widgets');
    if (activeLayout.widgets.length === 0) {
      activeList.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No widgets added. Select from available widgets.</p>';
    } else {
      activeList.innerHTML = activeLayout.widgets.map((w, i) => {
        const widgetDef = widgetTypes.find(t => t.id === w.type);
        return `
          <div class="p-3 bg-white border rounded shadow-sm flex justify-between items-center" draggable="true" data-index="${i}">
            <div class="flex items-center gap-3">
              <span class="text-gray-400 cursor-move">☰</span>
              <div>
                <div class="font-medium text-sm">${widgetDef?.name || w.type}</div>
                <div class="text-xs text-gray-500">Position: ${w.position?.x || 0}, ${w.position?.y || 0}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="moveWidgetUp(${i})" class="text-gray-400 hover:text-gray-600" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button onclick="moveWidgetDown(${i})" class="text-gray-400 hover:text-gray-600" ${i === activeLayout.widgets.length - 1 ? 'disabled' : ''}>↓</button>
              <button onclick="removeWidget(${i})" class="text-red-500 hover:text-red-700">×</button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render saved layouts
    const layoutsList = document.getElementById('saved-layouts');
    if (savedLayouts.length === 0) {
      layoutsList.innerHTML = '<p class="text-gray-500 text-sm col-span-4">No saved layouts.</p>';
    } else {
      layoutsList.innerHTML = savedLayouts.map(l => `
        <div class="p-4 border rounded hover:bg-gray-50">
          <div class="font-medium">${l.name}</div>
          <div class="text-xs text-gray-500">${l.widgets?.length || 0} widgets</div>
          <div class="flex gap-2 mt-2">
            <button onclick="loadLayout('${l.name}')" class="text-blue-600 hover:underline text-sm">Load</button>
            <button onclick="deleteLayout('${l.name}')" class="text-red-500 hover:underline text-sm">Delete</button>
          </div>
        </div>
      `).join('');
    }

  } catch (e) {
    console.error('Widgets load error:', e);
  }
}

async function toggleWidget(widgetId) {
  const existingIndex = activeLayout.widgets.findIndex(w => w.type === widgetId);

  if (existingIndex >= 0) {
    activeLayout.widgets.splice(existingIndex, 1);
  } else {
    activeLayout.widgets.push({
      type: widgetId,
      position: { x: 0, y: activeLayout.widgets.length },
      size: { w: 2, h: 2 }
    });
  }

  await saveDashboardLayout();
  loadWidgetsPage();
}

async function removeWidget(index) {
  activeLayout.widgets.splice(index, 1);
  await saveDashboardLayout();
  loadWidgetsPage();
}

async function moveWidgetUp(index) {
  if (index === 0) return;
  [activeLayout.widgets[index], activeLayout.widgets[index - 1]] =
    [activeLayout.widgets[index - 1], activeLayout.widgets[index]];
  await saveDashboardLayout();
  loadWidgetsPage();
}

async function moveWidgetDown(index) {
  if (index === activeLayout.widgets.length - 1) return;
  [activeLayout.widgets[index], activeLayout.widgets[index + 1]] =
    [activeLayout.widgets[index + 1], activeLayout.widgets[index]];
  await saveDashboardLayout();
  loadWidgetsPage();
}

async function saveDashboardLayout() {
  try {
    await fetch('/api/v1/widgets/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activeLayout)
    });
  } catch (e) {
    console.error('Error saving layout:', e);
  }
}

async function resetDashboardLayout() {
  if (!confirm('Reset dashboard to default layout?')) return;

  try {
    await fetch('/api/v1/widgets/layout/reset', { method: 'POST' });
    loadWidgetsPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function loadLayout(name) {
  try {
    await fetch('/api/v1/widgets/layout/load/' + encodeURIComponent(name), { method: 'POST' });
    loadWidgetsPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteLayout(name) {
  if (!confirm('Delete this saved layout?')) return;
  try {
    await fetch('/api/v1/widgets/layouts/' + encodeURIComponent(name), { method: 'DELETE' });
    loadWidgetsPage();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ============ ENHANCED SCORING FUNCTIONS ============

// Load score history for a SKU and display a chart
async function loadScoreHistory(sku, containerId = 'score-history-chart') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch(`/api/v1/scores/${encodeURIComponent(sku)}/history?days=30`);
    const { data } = await res.json();

    if (!data || data.length < 2) {
      container.innerHTML = '<p class="text-gray-500 text-sm">Not enough history data yet</p>';
      return;
    }

    // Simple text-based chart (or integrate with Chart.js if available)
    let html = '<div class="space-y-2">';
    html += `<p class="text-sm text-gray-500">${data.length} data points over last 30 days</p>`;
    html += '<div class="flex items-end gap-1 h-20">';

    const maxScore = Math.max(...data.map(d => d.totalScore));
    data.slice(-14).forEach(d => {
      const height = (d.totalScore / maxScore) * 100;
      const col = d.totalScore >= 80 ? 'bg-green-500' : d.totalScore >= 60 ? 'bg-yellow-500' : 'bg-red-500';
      html += `<div class="flex-1 ${col} rounded-t" style="height: ${height}%" title="${d.date}: ${d.totalScore}"></div>`;
    });

    html += '</div>';
    html += `<div class="flex justify-between text-xs text-gray-400"><span>${data[0]?.date || ''}</span><span>${data[data.length-1]?.date || ''}</span></div>`;
    html += '</div>';

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 text-sm">${e.message}</p>`;
  }
}

// Load score trends for a SKU
async function loadScoreTrends(sku, containerId = 'score-trends') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const res = await fetch(`/api/v1/scores/${encodeURIComponent(sku)}/trends`);
    const { data } = await res.json();

    if (data.trend === 'insufficient_data') {
      container.innerHTML = '<p class="text-gray-500 text-sm">Need more data for trend analysis</p>';
      return;
    }

    const trendIcon = data.trend === 'improving' ? '📈' : data.trend === 'declining' ? '📉' : '➡️';
    const trendCol = data.trend === 'improving' ? 'text-green-600' : data.trend === 'declining' ? 'text-red-600' : 'text-gray-600';
    const changeSign = data.change > 0 ? '+' : '';

    let html = `<div class="p-3 bg-gray-50 rounded">`;
    html += `<div class="flex items-center gap-2 mb-2"><span class="text-xl">${trendIcon}</span><span class="font-semibold ${trendCol}">${data.trend.toUpperCase()}</span></div>`;
    html += `<p class="text-sm">Score change: <span class="font-medium ${trendCol}">${changeSign}${data.change} points</span></p>`;
    html += `<p class="text-xs text-gray-500">Recent avg: ${data.recentAvg} | Previous avg: ${data.olderAvg}</p>`;

    // Component trends
    if (data.componentTrends) {
      html += '<div class="grid grid-cols-5 gap-2 mt-3 text-xs">';
      for (const [comp, trend] of Object.entries(data.componentTrends)) {
        const icon = trend.trend === 'improving' ? '↑' : trend.trend === 'declining' ? '↓' : '→';
        const col = trend.trend === 'improving' ? 'text-green-600' : trend.trend === 'declining' ? 'text-red-600' : 'text-gray-500';
        html += `<div class="text-center"><span class="capitalize">${comp}</span><br><span class="${col}">${icon} ${trend.change > 0 ? '+' : ''}${trend.change}</span></div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 text-sm">${e.message}</p>`;
  }
}

// Load compliance issues across all listings
async function loadComplianceIssues(containerId = 'compliance-issues') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<p class="text-gray-500">Loading compliance issues...</p>';

  try {
    const res = await fetch('/api/v1/scores/compliance-issues');
    const { data } = await res.json();

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-green-600 p-4">✓ No compliance issues found!</p>';
      return;
    }

    let html = `<div class="mb-2 text-sm text-red-600 font-medium">${data.length} listing(s) with compliance issues</div>`;
    html += '<div class="space-y-2 max-h-96 overflow-y-auto">';

    data.forEach(item => {
      const critCount = item.violations.filter(v => v.severity === 'critical' || v.severity === 'high').length;
      html += `<div class="p-3 border rounded ${critCount > 0 ? 'border-red-300 bg-red-50' : 'border-yellow-300 bg-yellow-50'}">`;
      html += `<div class="flex justify-between items-start mb-2"><div class="flex-1"><p class="font-medium text-sm truncate" title="${item.title}">${item.title.substring(0, 50)}...</p><p class="text-xs text-gray-500">SKU: ${item.sku}</p></div><span class="text-lg font-bold ${item.score >= 60 ? 'text-yellow-600' : 'text-red-600'}">${item.score}</span></div>`;
      html += '<div class="flex flex-wrap gap-1">';
      item.violations.slice(0, 5).forEach(v => {
        const col = v.severity === 'critical' ? 'bg-red-600' : v.severity === 'high' ? 'bg-red-500' : v.severity === 'medium' ? 'bg-yellow-500' : 'bg-gray-400';
        html += `<span class="px-2 py-0.5 rounded text-xs text-white ${col}">${v.term}</span>`;
      });
      if (item.violations.length > 5) {
        html += `<span class="px-2 py-0.5 rounded text-xs bg-gray-200">+${item.violations.length - 5} more</span>`;
      }
      html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="text-red-500">${e.message}</p>`;
  }
}

// =====================
// Listing Generator Functions
// =====================

let currentGeneratedListing = null;

async function loadGeneratorPage() {
  loadSavedGenerators();
}

async function loadSavedGenerators() {
  const container = document.getElementById('saved-generators');
  if (!container) return;

  container.innerHTML = '<p class="text-gray-500 text-sm">Loading...</p>';

  try {
    const res = await fetch('/api/v1/generator/saved');
    const { data } = await res.json();

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm">No saved drafts yet</p>';
      return;
    }

    let html = '';
    data.forEach(item => {
      // Support both savedAt and createdAt
      const dateStr = item.savedAt || item.createdAt || item.generatedAt;
      const date = dateStr ? new Date(dateStr).toLocaleDateString() : 'Unknown date';
      const displayTitle = item.title || item._detailed?.input?.name || 'Untitled';
      html += `<div class="p-3 border rounded hover:bg-gray-50 cursor-pointer" onclick="loadSavedGenerator('${item.id}')">
        <p class="font-medium text-sm truncate" title="${displayTitle}">${displayTitle.substring(0, 40)}${displayTitle.length > 40 ? '...' : ''}</p>
        <p class="text-xs text-gray-400">${date}</p>
        <button onclick="event.stopPropagation(); deleteSavedGenerator('${item.id}')" class="text-red-500 text-xs hover:underline mt-1">Delete</button>
      </div>`;
    });

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 text-sm">${e.message}</p>`;
  }
}

async function generateFromASINs() {
  const input = document.getElementById('gen-asins').value.trim();
  if (!input) {
    showNotification('Please enter at least one ASIN', 'warning');
    return;
  }

  // Validate ASIN format (10 alphanumeric characters)
  const asins = input.split(/[\n,]/)
    .map(a => a.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(a => a && a.length === 10 && /^[A-Z0-9]{10}$/.test(a));

  if (asins.length === 0) {
    showNotification('Please enter valid ASINs (10 alphanumeric characters each)', 'error');
    return;
  }

  const output = document.getElementById('gen-output');
  const resultsSection = document.getElementById('generator-results');
  const comparisonSection = document.getElementById('comparison-results');
  const generateBtn = document.querySelector('[onclick="generateFromASINs()"]');

  // Disable button and show loading state
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<span class="animate-pulse">Analyzing...</span>';
  }

  comparisonSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  output.innerHTML = `<div class="flex items-center justify-center p-8">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mr-3"></div>
    <span class="text-gray-500">Analyzing ASIN ${asins[0]}...</span>
  </div>`;

  try {
    // Always use the first ASIN for generation
    const res = await fetch(`/api/v1/generator/asin/${asins[0]}`);
    const result = await res.json();

    if (!res.ok || result.error) {
      const errorMsg = result.error || 'Failed to analyze ASIN';
      output.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded">
        <p class="text-red-700 font-medium">Error</p>
        <p class="text-red-600 text-sm">${escapeHtml(errorMsg)}</p>
        ${res.status === 429 ? '<p class="text-red-500 text-xs mt-2">Rate limit reached. Please wait a moment before trying again.</p>' : ''}
      </div>`;
      return;
    }

    currentGeneratedListing = result.data;
    displayGeneratedListing(result.data);
    showNotification('Listing generated successfully!', 'success');

    // If multiple ASINs, show a note
    if (asins.length > 1) {
      output.innerHTML += `<div class="mt-4 p-3 bg-blue-50 text-blue-700 text-sm rounded">
        <strong>Note:</strong> Showing results for first ASIN (${asins[0]}). Use "Compare Multiple" button to see all ${asins.length} ASINs side-by-side.
      </div>`;
    }
  } catch (e) {
    output.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded">
      <p class="text-red-700 font-medium">Connection Error</p>
      <p class="text-red-600 text-sm">${escapeHtml(e.message)}</p>
      <p class="text-gray-500 text-xs mt-2">Please check your connection and try again.</p>
    </div>`;
  } finally {
    // Re-enable button
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = 'Generate';
    }
  }
}

// Helper for showing notifications
function showNotification(message, type = 'info') {
  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500'
  };
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300`;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.classList.add('opacity-0');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

async function compareASINs() {
  const input = document.getElementById('gen-asins').value.trim();
  if (!input) {
    showNotification('Please enter ASINs to compare', 'warning');
    return;
  }

  const asins = input.split(/[\n,]/)
    .map(a => a.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(a => a && a.length === 10 && /^[A-Z0-9]{10}$/.test(a));

  if (asins.length < 2) {
    showNotification('Please enter at least 2 valid ASINs to compare', 'error');
    return;
  }

  if (asins.length > 10) {
    showNotification('Maximum 10 ASINs can be compared at once', 'warning');
    return;
  }

  const resultsSection = document.getElementById('generator-results');
  const comparisonSection = document.getElementById('comparison-results');
  const compareOutput = document.getElementById('compare-output');
  const compareBtn = document.querySelector('[onclick="compareASINs()"]');

  // Show loading state
  if (compareBtn) {
    compareBtn.disabled = true;
    compareBtn.innerHTML = '<span class="animate-pulse">Comparing...</span>';
  }

  resultsSection.classList.add('hidden');
  comparisonSection.classList.remove('hidden');
  compareOutput.innerHTML = `<div class="flex items-center justify-center p-8">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
    <span class="text-gray-500">Comparing ${asins.length} ASINs...</span>
  </div>`;

  try {
    const res = await fetch('/api/v1/generator/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asins })
    });
    const result = await res.json();

    if (!res.ok || result.error) {
      compareOutput.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded">
        <p class="text-red-700">${escapeHtml(result.error || 'Failed to compare ASINs')}</p>
      </div>`;
      return;
    }

    displayComparison(result.data);
    showNotification('Comparison complete!', 'success');
  } catch (e) {
    compareOutput.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded">
      <p class="text-red-700">${escapeHtml(e.message)}</p>
    </div>`;
  } finally {
    if (compareBtn) {
      compareBtn.disabled = false;
      compareBtn.innerHTML = 'Compare Multiple';
    }
  }
}

async function generateFromComponents() {
  const brand = document.getElementById('gen-brand').value.trim();
  const name = document.getElementById('gen-name').value.trim();
  const category = document.getElementById('gen-category').value;
  const material = document.getElementById('gen-material').value.trim();
  const features = document.getElementById('gen-features').value.trim().split('\n').filter(f => f.trim());
  const quantity = document.getElementById('gen-quantity').value.trim();
  const size = document.getElementById('gen-size').value.trim();
  const price = parseFloat(document.getElementById('gen-price').value) || null;

  if (!name) {
    showNotification('Please enter a product name', 'warning');
    document.getElementById('gen-name').focus();
    return;
  }

  const output = document.getElementById('gen-output');
  const resultsSection = document.getElementById('generator-results');
  const comparisonSection = document.getElementById('comparison-results');
  const generateBtn = document.querySelector('[onclick="generateFromComponents()"]');

  // Show loading state
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<span class="animate-pulse">Generating...</span>';
  }

  comparisonSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  output.innerHTML = `<div class="flex items-center justify-center p-8">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mr-3"></div>
    <span class="text-gray-500">Generating optimized listing...</span>
  </div>`;

  try {
    const res = await fetch('/api/v1/generator/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand,
        name,  // Backend now accepts 'name' as well as 'productName'
        category: category || 'tools',
        material,
        features,
        quantity,
        size,
        targetPrice: price
      })
    });
    const result = await res.json();

    if (!res.ok || result.error) {
      output.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded">
        <p class="text-red-700">${escapeHtml(result.error || 'Failed to generate listing')}</p>
      </div>`;
      return;
    }

    currentGeneratedListing = result.data;
    displayGeneratedListing(result.data);
    showNotification('Listing generated successfully!', 'success');
  } catch (e) {
    output.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded">
      <p class="text-red-700">${escapeHtml(e.message)}</p>
    </div>`;
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = 'Generate from Details';
    }
  }
}

function displayGeneratedListing(data) {
  const output = document.getElementById('gen-output');

  if (!data) {
    output.innerHTML = '<p class="text-red-500">No listing data available</p>';
    return;
  }

  // Helper to escape HTML
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  let html = '';

  // Title
  const title = data.title || 'N/A';
  const titleLength = title.length;
  const titleClass = titleLength >= 150 && titleLength <= 200 ? 'text-green-600' : titleLength < 100 ? 'text-red-600' : 'text-yellow-600';
  html += `<div class="border-b pb-4 mb-4">
    <div class="flex justify-between items-center">
      <label class="text-xs text-gray-500 uppercase">Title</label>
      <span class="text-xs ${titleClass}">${titleLength}/200 chars ${titleLength >= 150 && titleLength <= 200 ? '✓' : titleLength < 100 ? '(too short)' : ''}</span>
    </div>
    <p class="font-medium text-lg mt-1">${escapeHtml(title)}</p>
  </div>`;

  // Bullet Points
  const bullets = data.bulletPoints || [];
  html += `<div class="border-b pb-4 mb-4">
    <label class="text-xs text-gray-500 uppercase">Bullet Points (${bullets.length}/5)</label>`;
  if (bullets.length > 0) {
    html += '<ul class="list-disc ml-5 space-y-2 mt-2">';
    bullets.forEach((bp, i) => {
      const bpLength = bp?.length || 0;
      html += `<li class="text-sm">
        <span>${escapeHtml(bp)}</span>
        <span class="text-xs text-gray-400 ml-2">(${bpLength} chars)</span>
      </li>`;
    });
    html += '</ul>';
  } else {
    html += '<p class="text-gray-400 text-sm mt-1">No bullet points generated</p>';
  }
  html += '</div>';

  // Description
  const description = data.description || 'N/A';
  html += `<div class="border-b pb-4 mb-4">
    <label class="text-xs text-gray-500 uppercase">Description (${description.length} chars)</label>
    <p class="text-sm text-gray-700 whitespace-pre-wrap mt-1 p-2 bg-gray-50 rounded">${escapeHtml(description)}</p>
  </div>`;

  // Search Terms
  const searchTerms = data.searchTerms || '';
  const stLength = searchTerms.length;
  const stClass = stLength <= 250 ? 'text-green-600' : 'text-red-600';
  html += `<div class="border-b pb-4 mb-4">
    <div class="flex justify-between items-center">
      <label class="text-xs text-gray-500 uppercase">Backend Search Terms</label>
      <span class="text-xs ${stClass}">${stLength}/250 bytes ${stLength <= 250 ? '✓' : '(too long!)'}</span>
    </div>
    <p class="text-sm font-mono bg-gray-50 p-2 rounded mt-1 break-all">${escapeHtml(searchTerms) || 'N/A'}</p>
  </div>`;

  // Pricing suggestion if available
  if (data.pricingSuggestion && (data.pricingSuggestion.min || data.pricingSuggestion.recommended || data.pricingSuggestion.max)) {
    const ps = data.pricingSuggestion;
    html += `<div class="border-b pb-4 mb-4">
      <label class="text-xs text-gray-500 uppercase">Pricing Suggestion</label>
      <div class="grid grid-cols-3 gap-4 mt-2">
        <div class="p-3 bg-gray-50 rounded text-center">
          <p class="text-xs text-gray-500">Competitive</p>
          <p class="font-bold">${ps.min ? '£' + (parseFloat(ps.min)||0).toFixed(2) : 'N/A'}</p>
        </div>
        <div class="p-3 bg-green-50 rounded text-center border-2 border-green-200">
          <p class="text-xs text-green-700">Recommended</p>
          <p class="font-bold text-green-700">${ps.recommended ? '£' + (parseFloat(ps.recommended)||0).toFixed(2) : 'N/A'}</p>
        </div>
        <div class="p-3 bg-gray-50 rounded text-center">
          <p class="text-xs text-gray-500">Premium</p>
          <p class="font-bold">${ps.max ? '£' + (parseFloat(ps.max)||0).toFixed(2) : 'N/A'}</p>
        </div>
      </div>
    </div>`;
  }

  // Image recommendations
  const imageRecs = data.imageRecommendations || [];
  if (imageRecs.length > 0) {
    html += `<div class="border-b pb-4 mb-4">
      <label class="text-xs text-gray-500 uppercase">Image Recommendations</label>
      <ul class="list-none mt-2 space-y-1">`;
    imageRecs.forEach((rec, i) => {
      html += `<li class="text-sm flex items-start">
        <span class="text-green-500 mr-2">✓</span>
        <span>${escapeHtml(rec)}</span>
      </li>`;
    });
    html += '</ul></div>';
  }

  // Compliance check
  if (data.complianceCheck) {
    const cc = data.complianceCheck;
    const statusClass = cc.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
    const statusText = cc.passed ? '✓ Compliance Passed' : '⚠ Compliance Issues Found';

    html += `<div class="p-4 ${statusClass} border rounded">
      <p class="font-medium ${cc.passed ? 'text-green-700' : 'text-red-700'}">${statusText}</p>`;
    if (cc.issues && cc.issues.length > 0) {
      html += '<ul class="mt-2 text-sm space-y-1">';
      cc.issues.forEach(issue => {
        // Handle both string and object issues
        const issueText = typeof issue === 'string' ? issue : (issue.term ? `"${issue.term}" - ${issue.message || issue.category}` : JSON.stringify(issue));
        const severity = issue.severity || 'medium';
        const sevClass = severity === 'critical' || severity === 'high' ? 'text-red-600' : severity === 'medium' ? 'text-yellow-600' : 'text-gray-600';
        html += `<li class="${sevClass}">• ${escapeHtml(issueText)}</li>`;
      });
      html += '</ul>';
    }
    html += '</div>';
  }

  // Recommendations from ASIN analysis (if present)
  if (data.recommendations && data.recommendations.length > 0) {
    html += `<div class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
      <p class="font-medium text-blue-700 mb-2">Recommendations</p>
      <ul class="text-sm space-y-1">`;
    data.recommendations.forEach(rec => {
      const priority = rec.priority || 'medium';
      const prioClass = priority === 'high' || priority === 'critical' ? 'text-red-600' : priority === 'medium' ? 'text-yellow-600' : 'text-blue-600';
      html += `<li><span class="${prioClass} font-medium">[${priority.toUpperCase()}]</span> ${escapeHtml(rec.area || rec.title)}: ${escapeHtml(rec.suggestion || rec.description)}</li>`;
    });
    html += '</ul></div>';
  }

  output.innerHTML = html;
}

function displayComparison(data) {
  const output = document.getElementById('compare-output');

  if (!data.products || data.products.length === 0) {
    output.innerHTML = '<p class="text-gray-500">No data to compare</p>';
    return;
  }

  let html = '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-gray-50"><tr><th class="p-3 text-left">Attribute</th>';

  data.products.forEach(p => {
    html += `<th class="p-3 text-left">${p.asin}</th>`;
  });
  html += '</tr></thead><tbody>';

  // Title row
  html += '<tr class="border-t"><td class="p-3 font-medium">Title</td>';
  data.products.forEach(p => {
    html += `<td class="p-3 text-xs">${(p.title || 'N/A').substring(0, 60)}...</td>`;
  });
  html += '</tr>';

  // Price row
  html += '<tr class="border-t"><td class="p-3 font-medium">Price</td>';
  data.products.forEach(p => {
    html += `<td class="p-3">${p.price ? '£' + (parseFloat(p.price)||0).toFixed(2) : 'N/A'}</td>`;
  });
  html += '</tr>';

  // BSR row
  html += '<tr class="border-t"><td class="p-3 font-medium">BSR</td>';
  data.products.forEach(p => {
    html += `<td class="p-3">${p.bsr?.toLocaleString() || 'N/A'}</td>`;
  });
  html += '</tr>';

  // Rating row
  html += '<tr class="border-t"><td class="p-3 font-medium">Rating</td>';
  data.products.forEach(p => {
    html += `<td class="p-3">${p.rating || 'N/A'} ⭐</td>`;
  });
  html += '</tr>';

  // Reviews row
  html += '<tr class="border-t"><td class="p-3 font-medium">Reviews</td>';
  data.products.forEach(p => {
    html += `<td class="p-3">${p.reviewCount?.toLocaleString() || 'N/A'}</td>`;
  });
  html += '</tr>';

  html += '</tbody></table></div>';

  // Summary
  if (data.summary) {
    html += `<div class="mt-4 p-4 bg-blue-50 rounded">
      <p class="font-medium text-blue-700">Analysis Summary</p>
      <p class="text-sm text-blue-600 mt-1">${data.summary}</p>
    </div>`;
  }

  output.innerHTML = html;
}

function copyGeneratedListing() {
  if (!currentGeneratedListing) {
    alert('No listing to copy');
    return;
  }

  const text = `TITLE:\n${currentGeneratedListing.title}\n\nBULLET POINTS:\n${(currentGeneratedListing.bulletPoints || []).map((bp, i) => `${i+1}. ${bp}`).join('\n')}\n\nDESCRIPTION:\n${currentGeneratedListing.description}\n\nSEARCH TERMS:\n${currentGeneratedListing.searchTerms}`;

  navigator.clipboard.writeText(text).then(() => {
    alert('Listing copied to clipboard!');
  }).catch(e => {
    alert('Failed to copy: ' + e.message);
  });
}

async function saveGeneratedListing() {
  if (!currentGeneratedListing) {
    alert('No listing to save');
    return;
  }

  try {
    const res = await fetch('/api/v1/generator/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentGeneratedListing)
    });
    const { data, error } = await res.json();

    if (error) {
      alert('Failed to save: ' + error);
      return;
    }

    alert('Listing saved!');
    loadSavedGenerators();
  } catch (e) {
    alert('Failed to save: ' + e.message);
  }
}

async function loadSavedGenerator(id) {
  try {
    const res = await fetch('/api/v1/generator/saved');
    const { data } = await res.json();

    const item = data.find(d => d.id === id);
    if (item) {
      currentGeneratedListing = item;
      document.getElementById('generator-results').classList.remove('hidden');
      document.getElementById('comparison-results').classList.add('hidden');
      displayGeneratedListing(item);
    }
  } catch (e) {
    alert('Failed to load: ' + e.message);
  }
}

async function deleteSavedGenerator(id) {
  if (!confirm('Delete this saved listing?')) return;

  try {
    await fetch(`/api/v1/generator/saved/${id}`, { method: 'DELETE' });
    loadSavedGenerators();
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
}

// =====================
// End Listing Generator Functions
// =====================

// Load score summary with all 5 components
async function loadScoreSummary(containerId = 'score-summary') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<p class="text-gray-500">Loading score summary...</p>';

  try {
    const res = await fetch('/api/v1/scores/summary');
    const { data } = await res.json();

    let html = '<div class="grid grid-cols-2 gap-4">';

    // Overall stats
    html += '<div class="p-4 bg-gray-50 rounded">';
    html += `<p class="text-sm text-gray-500">Average Score</p>`;
    html += `<p class="text-3xl font-bold ${data.averageScore >= 80 ? 'text-green-600' : data.averageScore >= 60 ? 'text-yellow-600' : 'text-red-600'}">${data.averageScore}</p>`;
    html += `<p class="text-xs text-gray-400">${data.scoredListings} of ${data.totalListings} scored</p>`;
    html += '</div>';

    // Compliance issues
    html += '<div class="p-4 bg-gray-50 rounded">';
    html += `<p class="text-sm text-gray-500">Compliance Issues</p>`;
    html += `<p class="text-3xl font-bold ${data.complianceIssues > 0 ? 'text-red-600' : 'text-green-600'}">${data.complianceIssues}</p>`;
    html += `<p class="text-xs text-gray-400">listings need attention</p>`;
    html += '</div>';

    html += '</div>';

    // Component averages
    html += '<div class="grid grid-cols-5 gap-2 mt-4">';
    const labels = { seo: 'SEO', content: 'Content', images: 'Images', competitive: 'Competitive', compliance: 'Compliance' };
    for (const [comp, label] of Object.entries(labels)) {
      const score = data.componentAverages[comp] || 0;
      const col = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600';
      html += `<div class="text-center p-2 bg-gray-50 rounded"><p class="text-xs text-gray-500">${label}</p><p class="text-xl font-bold ${col}">${score}</p></div>`;
    }
    html += '</div>';

    // Distribution
    html += '<div class="mt-4 p-3 bg-gray-50 rounded">';
    html += '<p class="text-xs text-gray-500 mb-2">Score Distribution</p>';
    html += '<div class="flex gap-2">';
    const total = data.distribution.excellent + data.distribution.good + data.distribution.average + data.distribution.poor;
    if (total > 0) {
      const pct = (n) => Math.round((n / total) * 100);
      html += `<div class="bg-green-500 text-white text-xs p-1 text-center" style="flex: ${pct(data.distribution.excellent)}%">${data.distribution.excellent}</div>`;
      html += `<div class="bg-yellow-500 text-white text-xs p-1 text-center" style="flex: ${pct(data.distribution.good)}%">${data.distribution.good}</div>`;
      html += `<div class="bg-orange-500 text-white text-xs p-1 text-center" style="flex: ${pct(data.distribution.average)}%">${data.distribution.average}</div>`;
      html += `<div class="bg-red-500 text-white text-xs p-1 text-center" style="flex: ${pct(data.distribution.poor)}%">${data.distribution.poor}</div>`;
    }
    html += '</div>';
    html += '<div class="flex justify-between text-xs text-gray-400 mt-1"><span>Excellent (80+)</span><span>Good (60-79)</span><span>Avg (40-59)</span><span>Poor (&lt;40)</span></div>';
    html += '</div>';

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<p class="text-red-500">${e.message}</p>`;
  }
}

// ============================================
// BOM IMPORT FUNCTIONS
// ============================================

let importData = [];

function showImportModal() {
  document.getElementById('import-modal').classList.remove('hidden');
  document.getElementById('import-file').value = '';
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('import-results').classList.add('hidden');
  document.getElementById('btn-execute-import').classList.add('hidden');
  importData = [];
}

function hideImportModal() {
  document.getElementById('import-modal').classList.add('hidden');
  importData = [];
}

function downloadImportTemplate() {
  const template = `SKU,Component,Qty,Cost,Supplier
INV-TOOL-001,M8 Hex Bolt,4,0.15,FastFasteners UK
INV-TOOL-001,Rubber Washer,4,0.05,FastFasteners UK
INV-TOOL-001,Packaging Box Small,1,0.45,PackCo
INV-TOOL-002,Allen Key 5mm,1,1.20,Tool Supplies Ltd
INV-TOOL-002,Carrying Pouch,1,0.80,PackCo`;

  const blob = new Blob([template], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bom-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function previewImport() {
  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];

  if (!file) {
    alert('Please select a file first');
    return;
  }

  const previewDiv = document.getElementById('import-preview');
  const tableDiv = document.getElementById('import-preview-table');
  const resultsDiv = document.getElementById('import-results');

  try {
    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length < 2) {
      throw new Error('File must have at least a header row and one data row');
    }

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const requiredCols = ['sku', 'component', 'qty', 'cost', 'supplier'];
    const missingCols = requiredCols.filter(c => !headers.includes(c));

    if (missingCols.length > 0) {
      throw new Error(`Missing required columns: ${missingCols.join(', ')}`);
    }

    const skuIdx = headers.indexOf('sku');
    const compIdx = headers.indexOf('component');
    const qtyIdx = headers.indexOf('qty');
    const costIdx = headers.indexOf('cost');
    const suppIdx = headers.indexOf('supplier');

    importData = rows.slice(1).filter(row => row.length >= 5 && row[skuIdx]).map(row => ({
      sku: row[skuIdx]?.trim() || '',
      component: row[compIdx]?.trim() || '',
      qty: parseFloat(row[qtyIdx]) || 1,
      cost: parseFloat(row[costIdx]) || 0,
      supplier: row[suppIdx]?.trim() || ''
    }));

    // Show preview table
    let html = `<table class="w-full text-xs border"><thead class="bg-gray-100">
      <tr><th class="p-2 border">SKU</th><th class="p-2 border">Component</th><th class="p-2 border">Qty</th><th class="p-2 border">Cost</th><th class="p-2 border">Supplier</th></tr>
    </thead><tbody>`;

    importData.slice(0, 5).forEach(row => {
      html += `<tr>
        <td class="p-2 border">${row.sku}</td>
        <td class="p-2 border">${row.component}</td>
        <td class="p-2 border">${row.qty}</td>
        <td class="p-2 border">£${(parseFloat(row.cost)||0).toFixed(2)}</td>
        <td class="p-2 border">${row.supplier}</td>
      </tr>`;
    });

    if (importData.length > 5) {
      html += `<tr><td colspan="5" class="p-2 border text-center text-gray-500">... and ${importData.length - 5} more rows</td></tr>`;
    }

    html += '</tbody></table>';
    html += `<p class="text-sm text-gray-600 mt-2">Total rows to import: <strong>${importData.length}</strong></p>`;

    tableDiv.innerHTML = html;
    previewDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    document.getElementById('btn-execute-import').classList.remove('hidden');

  } catch (e) {
    tableDiv.innerHTML = `<p class="text-red-600">${e.message}</p>`;
    previewDiv.classList.remove('hidden');
    document.getElementById('btn-execute-import').classList.add('hidden');
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }).filter(row => row.some(cell => cell.trim()));
}

async function executeImport() {
  if (!importData.length) {
    alert('No data to import. Please preview first.');
    return;
  }

  const btn = document.getElementById('btn-execute-import');
  const resultsDiv = document.getElementById('import-results');

  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const res = await fetch('/api/v1/bom/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: importData })
    });

    const result = await res.json();

    if (result.success) {
      resultsDiv.className = 'mb-4 p-4 rounded bg-green-50 border border-green-200';
      resultsDiv.innerHTML = `
        <p class="text-green-800 font-medium">✅ Import Complete!</p>
        <p class="text-sm text-green-700 mt-1">
          ${result.data.suppliersCreated} suppliers created<br>
          ${result.data.componentsCreated} components created<br>
          ${result.data.bomEntriesCreated} BOM entries added
        </p>
      `;

      // Refresh BOM page data
      setTimeout(() => {
        loadBOMPage();
        hideImportModal();
      }, 2000);
    } else {
      throw new Error(result.error || 'Import failed');
    }

  } catch (e) {
    resultsDiv.className = 'mb-4 p-4 rounded bg-red-50 border border-red-200';
    resultsDiv.innerHTML = `<p class="text-red-800">❌ Error: ${e.message}</p>`;
  }

  resultsDiv.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Import';
}

// ============================================================================
// EDIT PRICE MODAL (Slice B - API v2)
// ============================================================================

let currentPriceEditListingId = null;
let currentPricePreviewData = null;

/**
 * Open the Edit Price modal for a listing
 * @param {number} listingId
 */
async function openEditPriceModal(listingId) {
  currentPriceEditListingId = listingId;
  currentPricePreviewData = null;

  // Create modal if not exists
  if (!document.getElementById('edit-price-modal')) {
    createEditPriceModal();
  }

  // Get current economics
  const modal = document.getElementById('edit-price-modal');
  const contentDiv = document.getElementById('edit-price-content');
  const previewDiv = document.getElementById('edit-price-preview');
  const publishBtn = document.getElementById('btn-publish-price');

  publishBtn.disabled = true;
  previewDiv.innerHTML = '';

  try {
    const economics = await loadEconomicsV2(listingId);

    contentDiv.innerHTML = `
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">Current Price (inc VAT)</label>
        <div class="text-lg font-bold">£${economics.price_inc_vat.toFixed(2)}</div>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">Current Profit (ex VAT)</label>
        <div class="text-lg ${economics.profit_ex_vat >= 0 ? 'text-green-600' : 'text-red-600'}">
          £${economics.profit_ex_vat.toFixed(2)} (${(economics.margin * 100).toFixed(1)}%)
        </div>
      </div>
      <div class="mb-4">
        <label for="new-price-input" class="block text-sm font-medium text-gray-700 mb-1">New Price (inc VAT)</label>
        <div class="flex">
          <span class="inline-flex items-center px-3 bg-gray-100 border border-r-0 rounded-l">£</span>
          <input type="number" id="new-price-input" step="0.01" min="0"
                 class="flex-1 border rounded-r px-3 py-2 focus:ring-2 focus:ring-blue-500"
                 value="${economics.price_inc_vat.toFixed(2)}"
                 onchange="previewPriceChange()">
        </div>
      </div>
      <div class="mb-4">
        <label for="price-reason-input" class="block text-sm font-medium text-gray-700 mb-1">Reason for Change</label>
        <textarea id="price-reason-input" rows="2"
                  class="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Competitor price adjustment, Buy Box recovery"></textarea>
      </div>
      <button onclick="previewPriceChange()" class="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600">
        Preview Change
      </button>
    `;

    modal.classList.remove('hidden');
  } catch (error) {
    contentDiv.innerHTML = `<div class="text-red-600">Error loading listing: ${error.message}</div>`;
    modal.classList.remove('hidden');
  }
}

/**
 * Create the Edit Price modal HTML
 */
function createEditPriceModal() {
  const modal = document.createElement('div');
  modal.id = 'edit-price-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden z-50 flex items-center justify-center';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-6 py-4 border-b">
        <h2 class="text-xl font-bold">Edit Price</h2>
        <button onclick="closeEditPriceModal()" class="text-gray-500 hover:text-gray-700">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="p-6">
        <div id="edit-price-content">Loading...</div>
        <div id="edit-price-preview" class="mt-4"></div>
        <div class="mt-4 flex gap-2">
          <button onclick="closeEditPriceModal()" class="flex-1 bg-gray-200 text-gray-800 py-2 rounded hover:bg-gray-300">
            Cancel
          </button>
          <button id="btn-publish-price" onclick="publishPriceChange()" disabled
                  class="flex-1 bg-green-500 text-white py-2 rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Publish to Amazon
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

/**
 * Preview price change with guardrails
 */
async function previewPriceChange() {
  const newPrice = parseFloat(document.getElementById('new-price-input').value);
  const previewDiv = document.getElementById('edit-price-preview');
  const publishBtn = document.getElementById('btn-publish-price');

  if (isNaN(newPrice) || newPrice <= 0) {
    previewDiv.innerHTML = '<div class="text-red-600">Please enter a valid price</div>';
    publishBtn.disabled = true;
    return;
  }

  previewDiv.innerHTML = '<div class="text-gray-500">Loading preview...</div>';

  try {
    const res = await fetch(`/api/v2/listings/${currentPriceEditListingId}/price/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_inc_vat: newPrice })
    });

    const preview = await res.json();

    if (!res.ok) {
      throw new Error(preview.error || 'Preview failed');
    }

    currentPricePreviewData = preview;

    const guardrailsHtml = preview.guardrails.passed
      ? '<div class="flex items-center text-green-600"><span class="mr-2">✓</span> Guardrails passed</div>'
      : `<div class="text-red-600">
           <div class="font-medium">⚠ Guardrails violations:</div>
           <ul class="list-disc ml-4 text-sm">
             ${preview.guardrails.violations.map(v => `<li>${v.message}</li>`).join('')}
           </ul>
         </div>`;

    previewDiv.innerHTML = `
      <div class="bg-gray-50 rounded p-4">
        <div class="text-sm font-medium text-gray-500 mb-2">Preview</div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-500">New Price (ex VAT)</div>
            <div class="font-medium">£${preview.proposed.price_ex_vat.toFixed(2)}</div>
          </div>
          <div>
            <div class="text-xs text-gray-500">Price Change</div>
            <div class="font-medium ${preview.impact.price_change >= 0 ? 'text-green-600' : 'text-red-600'}">
              ${preview.impact.price_change >= 0 ? '+' : ''}£${preview.impact.price_change.toFixed(2)}
              (${(preview.impact.price_change_pct * 100).toFixed(1)}%)
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">New Profit (ex VAT)</div>
            <div class="font-medium ${preview.proposed.profit_ex_vat >= 0 ? 'text-green-600' : 'text-red-600'}">
              £${preview.proposed.profit_ex_vat.toFixed(2)}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">New Margin</div>
            <div class="font-medium ${preview.proposed.margin >= 0.15 ? 'text-green-600' : 'text-amber-600'}">
              ${(preview.proposed.margin * 100).toFixed(1)}%
            </div>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t">
          ${guardrailsHtml}
        </div>
        ${preview.inventory.days_of_cover !== null ? `
          <div class="mt-2 text-xs text-gray-500">
            Stock: ${preview.inventory.available_quantity} units (${preview.inventory.days_of_cover} days cover)
          </div>
        ` : ''}
      </div>
    `;

    publishBtn.disabled = !preview.guardrails.passed;

  } catch (error) {
    previewDiv.innerHTML = `<div class="text-red-600">Error: ${error.message}</div>`;
    publishBtn.disabled = true;
  }
}

/**
 * Publish price change to Amazon
 */
async function publishPriceChange() {
  const newPrice = parseFloat(document.getElementById('new-price-input').value);
  const reason = document.getElementById('price-reason-input').value.trim();
  const publishBtn = document.getElementById('btn-publish-price');
  const previewDiv = document.getElementById('edit-price-preview');

  if (!reason) {
    alert('Please provide a reason for the price change');
    return;
  }

  publishBtn.disabled = true;
  publishBtn.textContent = 'Publishing...';

  try {
    const res = await fetch(`/api/v2/listings/${currentPriceEditListingId}/price/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_inc_vat: newPrice,
        reason: reason
      })
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Publish failed');
    }

    previewDiv.innerHTML = `
      <div class="bg-green-50 border border-green-200 rounded p-4 text-green-800">
        <div class="font-medium">✓ Price change submitted!</div>
        <div class="text-sm mt-1">Job ID: ${result.job_id}</div>
        <div class="text-sm">The change will be processed shortly.</div>
      </div>
    `;

    // Close modal after delay
    setTimeout(() => {
      closeEditPriceModal();
      // Refresh listing if we have a refresh function
      if (typeof refreshListingData === 'function') {
        refreshListingData(currentPriceEditListingId);
      }
    }, 2000);

  } catch (error) {
    previewDiv.innerHTML += `<div class="mt-2 text-red-600">Error: ${error.message}</div>`;
    publishBtn.disabled = false;
    publishBtn.textContent = 'Publish to Amazon';
  }
}

/**
 * Close the Edit Price modal
 */
function closeEditPriceModal() {
  const modal = document.getElementById('edit-price-modal');
  if (modal) modal.classList.add('hidden');
  currentPriceEditListingId = null;
  currentPricePreviewData = null;
}

// ============================================================================
// EDIT STOCK MODAL (Slice B - API v2)
// ============================================================================

let currentStockEditListingId = null;
let currentStockPreviewData = null;

/**
 * Open the Edit Stock modal for a listing
 * @param {number} listingId
 */
async function openEditStockModal(listingId) {
  currentStockEditListingId = listingId;
  currentStockPreviewData = null;

  // Create modal if not exists
  if (!document.getElementById('edit-stock-modal')) {
    createEditStockModal();
  }

  const modal = document.getElementById('edit-stock-modal');
  const contentDiv = document.getElementById('edit-stock-content');
  const previewDiv = document.getElementById('edit-stock-preview');
  const publishBtn = document.getElementById('btn-publish-stock');

  publishBtn.disabled = true;
  previewDiv.innerHTML = '';

  try {
    // Get current listing data
    const res = await fetch(`/api/v2/listings/${listingId}/guardrails-summary`);
    const summary = await res.json();

    if (!res.ok) {
      throw new Error(summary.error || 'Failed to load listing');
    }

    contentDiv.innerHTML = `
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
        <div class="text-lg font-bold">${summary.current_state.available_quantity} units</div>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">Sales Velocity</label>
        <div class="text-lg">${summary.current_state.sales_velocity_30d} units/day</div>
      </div>
      ${summary.current_state.days_of_cover !== null ? `
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Days of Cover</label>
          <div class="text-lg ${summary.current_state.stockout_risk === 'HIGH' ? 'text-red-600' : summary.current_state.stockout_risk === 'MEDIUM' ? 'text-amber-600' : 'text-green-600'}">
            ${summary.current_state.days_of_cover} days (${summary.current_state.stockout_risk} risk)
          </div>
        </div>
      ` : ''}
      <div class="mb-4">
        <label for="new-stock-input" class="block text-sm font-medium text-gray-700 mb-1">New Stock Quantity</label>
        <input type="number" id="new-stock-input" min="0" step="1"
               class="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500"
               value="${summary.current_state.available_quantity}"
               onchange="previewStockChange()">
      </div>
      <div class="mb-4">
        <label for="stock-reason-input" class="block text-sm font-medium text-gray-700 mb-1">Reason for Change</label>
        <textarea id="stock-reason-input" rows="2"
                  class="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., New shipment received, Inventory adjustment"></textarea>
      </div>
      <button onclick="previewStockChange()" class="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600">
        Preview Change
      </button>
    `;

    modal.classList.remove('hidden');
  } catch (error) {
    contentDiv.innerHTML = `<div class="text-red-600">Error loading listing: ${error.message}</div>`;
    modal.classList.remove('hidden');
  }
}

/**
 * Create the Edit Stock modal HTML
 */
function createEditStockModal() {
  const modal = document.createElement('div');
  modal.id = 'edit-stock-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden z-50 flex items-center justify-center';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-6 py-4 border-b">
        <h2 class="text-xl font-bold">Edit Stock</h2>
        <button onclick="closeEditStockModal()" class="text-gray-500 hover:text-gray-700">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="p-6">
        <div id="edit-stock-content">Loading...</div>
        <div id="edit-stock-preview" class="mt-4"></div>
        <div class="mt-4 flex gap-2">
          <button onclick="closeEditStockModal()" class="flex-1 bg-gray-200 text-gray-800 py-2 rounded hover:bg-gray-300">
            Cancel
          </button>
          <button id="btn-publish-stock" onclick="publishStockChange()" disabled
                  class="flex-1 bg-green-500 text-white py-2 rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Publish to Amazon
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

/**
 * Preview stock change
 */
async function previewStockChange() {
  const newQuantity = parseInt(document.getElementById('new-stock-input').value, 10);
  const previewDiv = document.getElementById('edit-stock-preview');
  const publishBtn = document.getElementById('btn-publish-stock');

  if (isNaN(newQuantity) || newQuantity < 0) {
    previewDiv.innerHTML = '<div class="text-red-600">Please enter a valid quantity</div>';
    publishBtn.disabled = true;
    return;
  }

  previewDiv.innerHTML = '<div class="text-gray-500">Loading preview...</div>';

  try {
    const res = await fetch(`/api/v2/listings/${currentStockEditListingId}/stock/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available_quantity: newQuantity })
    });

    const preview = await res.json();

    if (!res.ok) {
      throw new Error(preview.error || 'Preview failed');
    }

    currentStockPreviewData = preview;

    const riskColor = {
      'LOW': 'text-green-600',
      'MEDIUM': 'text-amber-600',
      'HIGH': 'text-red-600'
    };

    const warningsHtml = preview.guardrails.violations.length > 0
      ? `<div class="text-amber-600 mt-2">
           <div class="font-medium">⚠ Warnings:</div>
           <ul class="list-disc ml-4 text-sm">
             ${preview.guardrails.violations.map(v => `<li>${v.message}</li>`).join('')}
           </ul>
         </div>`
      : '';

    previewDiv.innerHTML = `
      <div class="bg-gray-50 rounded p-4">
        <div class="text-sm font-medium text-gray-500 mb-2">Preview</div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-500">New Stock</div>
            <div class="font-medium">${preview.proposed.available_quantity} units</div>
          </div>
          <div>
            <div class="text-xs text-gray-500">Stock Change</div>
            <div class="font-medium ${preview.impact.quantity_change >= 0 ? 'text-green-600' : 'text-red-600'}">
              ${preview.impact.quantity_change >= 0 ? '+' : ''}${preview.impact.quantity_change} units
            </div>
          </div>
          ${preview.proposed.days_of_cover !== null ? `
            <div>
              <div class="text-xs text-gray-500">New Days of Cover</div>
              <div class="font-medium">${preview.proposed.days_of_cover} days</div>
            </div>
            <div>
              <div class="text-xs text-gray-500">Stockout Risk</div>
              <div class="font-medium ${riskColor[preview.proposed.stockout_risk]}">
                ${preview.proposed.stockout_risk}
              </div>
            </div>
          ` : ''}
        </div>
        ${warningsHtml}
      </div>
    `;

    // Stock changes are less restrictive, enable publish even with warnings
    publishBtn.disabled = false;

  } catch (error) {
    previewDiv.innerHTML = `<div class="text-red-600">Error: ${error.message}</div>`;
    publishBtn.disabled = true;
  }
}

/**
 * Publish stock change to Amazon
 */
async function publishStockChange() {
  const newQuantity = parseInt(document.getElementById('new-stock-input').value, 10);
  const reason = document.getElementById('stock-reason-input').value.trim();
  const publishBtn = document.getElementById('btn-publish-stock');
  const previewDiv = document.getElementById('edit-stock-preview');

  if (!reason) {
    alert('Please provide a reason for the stock change');
    return;
  }

  publishBtn.disabled = true;
  publishBtn.textContent = 'Publishing...';

  try {
    const res = await fetch(`/api/v2/listings/${currentStockEditListingId}/stock/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        available_quantity: newQuantity,
        reason: reason
      })
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Publish failed');
    }

    previewDiv.innerHTML = `
      <div class="bg-green-50 border border-green-200 rounded p-4 text-green-800">
        <div class="font-medium">✓ Stock change submitted!</div>
        <div class="text-sm mt-1">Job ID: ${result.job_id}</div>
        <div class="text-sm">The change will be processed shortly.</div>
      </div>
    `;

    // Close modal after delay
    setTimeout(() => {
      closeEditStockModal();
      if (typeof refreshListingData === 'function') {
        refreshListingData(currentStockEditListingId);
      }
    }, 2000);

  } catch (error) {
    previewDiv.innerHTML += `<div class="mt-2 text-red-600">Error: ${error.message}</div>`;
    publishBtn.disabled = false;
    publishBtn.textContent = 'Publish to Amazon';
  }
}

/**
 * Close the Edit Stock modal
 */
function closeEditStockModal() {
  const modal = document.getElementById('edit-stock-modal');
  if (modal) modal.classList.add('hidden');
  currentStockEditListingId = null;
  currentStockPreviewData = null;
}

// ============================================================================
// JOBS PANEL (Slice B - API v2)
// ============================================================================

/**
 * Load and display recent jobs
 * @param {string} containerId - ID of container element
 * @param {Object} options - Filter options
 */
async function loadJobsPanel(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="text-gray-500">Loading jobs...</div>';

  try {
    const params = new URLSearchParams();
    if (options.types) params.set('types', options.types.join(','));
    if (options.statuses) params.set('statuses', options.statuses.join(','));
    if (options.limit) params.set('limit', options.limit);

    const res = await fetch(`/api/v2/jobs?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load jobs');
    }

    if (data.jobs.length === 0) {
      container.innerHTML = '<div class="text-gray-500 text-center py-4">No jobs found</div>';
      return;
    }

    const statusBadge = (status) => {
      const colors = {
        'PENDING': 'bg-yellow-100 text-yellow-800',
        'RUNNING': 'bg-blue-100 text-blue-800',
        'SUCCEEDED': 'bg-green-100 text-green-800',
        'FAILED': 'bg-red-100 text-red-800',
        'CANCELLED': 'bg-gray-100 text-gray-800',
      };
      return `<span class="px-2 py-0.5 rounded text-xs ${colors[status] || 'bg-gray-100'}">${status}</span>`;
    };

    container.innerHTML = `
      <div class="space-y-2">
        ${data.jobs.map(job => `
          <div class="bg-white border rounded p-3 hover:bg-gray-50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-medium">#${job.id}</span>
                ${statusBadge(job.status)}
                <span class="text-sm text-gray-600">${job.job_type.replace(/_/g, ' ')}</span>
              </div>
              <span class="text-xs text-gray-400">${new Date(job.created_at).toLocaleString()}</span>
            </div>
            ${job.listing_sku ? `<div class="text-sm text-gray-500 mt-1">SKU: ${job.listing_sku}</div>` : ''}
            ${job.error_message ? `<div class="text-xs text-red-600 mt-1">${job.error_message}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;

  } catch (error) {
    container.innerHTML = `<div class="text-red-600">Error: ${error.message}</div>`;
  }
}

/**
 * Load listing event history
 * @param {number} listingId
 * @param {string} containerId
 */
async function loadListingEventHistory(listingId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="text-gray-500">Loading history...</div>';

  try {
    const res = await fetch(`/api/v2/listings/${listingId}/events?limit=20`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load events');
    }

    if (data.events.length === 0) {
      container.innerHTML = '<div class="text-gray-500 text-center py-4">No events found</div>';
      return;
    }

    const eventIcon = (type) => {
      if (type.includes('PRICE')) return '💰';
      if (type.includes('STOCK')) return '📦';
      if (type.includes('BOM')) return '🔧';
      if (type.includes('SYNC')) return '🔄';
      return '📋';
    };

    const eventColor = (type) => {
      if (type.includes('SUCCEEDED')) return 'border-green-200 bg-green-50';
      if (type.includes('FAILED')) return 'border-red-200 bg-red-50';
      if (type.includes('DRAFTED') || type.includes('PUBLISHED')) return 'border-blue-200 bg-blue-50';
      return 'border-gray-200';
    };

    container.innerHTML = `
      <div class="space-y-2">
        ${data.events.map(event => `
          <div class="border rounded p-3 ${eventColor(event.event_type)}">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span>${eventIcon(event.event_type)}</span>
                <span class="text-sm font-medium">${event.event_type.replace(/_/g, ' ')}</span>
              </div>
              <span class="text-xs text-gray-400">${new Date(event.created_at).toLocaleString()}</span>
            </div>
            ${event.reason ? `<div class="text-sm text-gray-600 mt-1">${event.reason}</div>` : ''}
            ${event.before_json && event.after_json ? `
              <div class="text-xs text-gray-500 mt-1">
                ${formatEventChange(event.before_json, event.after_json)}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;

  } catch (error) {
    container.innerHTML = `<div class="text-red-600">Error: ${error.message}</div>`;
  }
}

/**
 * Format event change for display
 */
function formatEventChange(before, after) {
  const changes = [];

  if (before.price_inc_vat !== undefined && after.price_inc_vat !== undefined) {
    changes.push(`Price: £${before.price_inc_vat} → £${after.price_inc_vat}`);
  }

  if (before.available_quantity !== undefined && after.available_quantity !== undefined) {
    changes.push(`Stock: ${before.available_quantity} → ${after.available_quantity}`);
  }

  return changes.join(' | ') || '';
}

// ============================================
// SLICE E: ASIN ANALYZER + RESEARCH POOL
// ============================================

let currentAsinEntityId = null;
let researchPoolData = [];

/**
 * Initialize ASIN Analyzer UI
 */
async function initAsinAnalyzer() {
  await loadResearchPoolSummary();
  await loadResearchPool();
}

/**
 * Analyze an ASIN - triggers Keepa sync and feature computation
 */
async function analyzeAsin(asin, marketplaceId = 1) {
  if (!asin || asin.trim().length === 0) {
    alert('Please enter an ASIN');
    return null;
  }

  const sanitized = asin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (sanitized.length !== 10) {
    alert('ASIN must be exactly 10 characters');
    return null;
  }

  try {
    const res = await fetch('/api/v2/asins/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asin: sanitized, marketplace_id: marketplaceId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to analyze ASIN');

    currentAsinEntityId = data.asin_entity_id;
    return data;
  } catch (error) {
    console.error('ASIN analyze error:', error);
    alert('Error: ' + error.message);
    return null;
  }
}

/**
 * Get ASIN entity details with features
 */
async function getAsinDetails(asinEntityId) {
  try {
    const res = await fetch(`/api/v2/asins/${asinEntityId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get ASIN details');
    return data;
  } catch (error) {
    console.error('Get ASIN details error:', error);
    return null;
  }
}

/**
 * Track/untrack an ASIN in research pool
 */
async function toggleAsinTracking(asinEntityId, track) {
  try {
    const method = track ? 'POST' : 'DELETE';
    const res = await fetch(`/api/v2/asins/${asinEntityId}/track`, { method });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update tracking');
    await loadResearchPool();
    return data;
  } catch (error) {
    console.error('Toggle tracking error:', error);
    alert('Error: ' + error.message);
    return null;
  }
}

/**
 * Load research pool summary stats
 */
async function loadResearchPoolSummary() {
  const summaryEl = document.getElementById('research-pool-summary');
  if (!summaryEl) return;

  try {
    const res = await fetch('/api/v2/research-pool/summary');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load summary');

    summaryEl.innerHTML = `
      <div class="grid grid-cols-5 gap-4">
        <div class="bg-blue-50 p-3 rounded text-center">
          <div class="text-2xl font-bold text-blue-600">${data.total_tracked}</div>
          <div class="text-xs text-gray-600">Tracked ASINs</div>
        </div>
        <div class="bg-green-50 p-3 rounded text-center">
          <div class="text-2xl font-bold text-green-600">${data.converted_count}</div>
          <div class="text-xs text-gray-600">Converted</div>
        </div>
        <div class="bg-yellow-50 p-3 rounded text-center">
          <div class="text-2xl font-bold text-yellow-600">${data.unconverted_count}</div>
          <div class="text-xs text-gray-600">Pending</div>
        </div>
        <div class="bg-purple-50 p-3 rounded text-center">
          <div class="text-2xl font-bold text-purple-600">${data.with_scenario_bom}</div>
          <div class="text-xs text-gray-600">With BOM</div>
        </div>
        <div class="bg-emerald-50 p-3 rounded text-center">
          <div class="text-2xl font-bold text-emerald-600">${data.high_opportunity_count}</div>
          <div class="text-xs text-gray-600">High Opportunity</div>
        </div>
      </div>
    `;
  } catch (error) {
    summaryEl.innerHTML = `<div class="text-red-600">Error loading summary: ${error.message}</div>`;
  }
}

/**
 * Load research pool list
 */
async function loadResearchPool(sortBy = 'opportunity_margin', sortDir = 'desc') {
  const listEl = document.getElementById('research-pool-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="text-gray-500 text-center py-8">Loading research pool...</div>';

  try {
    const res = await fetch(`/api/v2/research-pool?sort_by=${sortBy}&sort_dir=${sortDir}&limit=50`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load research pool');

    researchPoolData = data.items;

    if (data.items.length === 0) {
      listEl.innerHTML = `
        <div class="text-center py-8">
          <p class="text-gray-500 mb-4">No ASINs in research pool</p>
          <p class="text-sm text-gray-400">Use the ASIN Analyzer to find and track ASINs</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-100">
            <tr>
              <th class="text-left p-2">ASIN</th>
              <th class="text-left p-2">Title</th>
              <th class="text-right p-2">Price</th>
              <th class="text-right p-2">BOM Cost</th>
              <th class="text-right p-2 cursor-pointer hover:bg-gray-200" onclick="loadResearchPool('opportunity_margin', '${sortBy === 'opportunity_margin' && sortDir === 'desc' ? 'asc' : 'desc'}')">
                Margin ${sortBy === 'opportunity_margin' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="text-right p-2">Score</th>
              <th class="text-center p-2">Status</th>
              <th class="text-center p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map(item => renderResearchPoolRow(item)).join('')}
          </tbody>
        </table>
      </div>
      <div class="text-xs text-gray-500 mt-2">Showing ${data.items.length} of ${data.total} tracked ASINs</div>
    `;
  } catch (error) {
    listEl.innerHTML = `<div class="text-red-600">Error: ${error.message}</div>`;
  }
}

/**
 * Render a single research pool row
 */
function renderResearchPoolRow(item) {
  const marginColor = item.opportunity_margin > 0.15 ? 'text-green-600' :
                      item.opportunity_margin > 0.10 ? 'text-yellow-600' :
                      item.opportunity_margin > 0 ? 'text-orange-600' : 'text-gray-500';

  const scoreColor = item.opportunity_score >= 50 ? 'bg-green-100 text-green-800' :
                     item.opportunity_score >= 30 ? 'bg-yellow-100 text-yellow-800' :
                     'bg-gray-100 text-gray-600';

  const statusBadge = item.is_converted ?
    `<span class="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">Converted</span>` :
    item.has_scenario_bom ?
    `<span class="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">Has BOM</span>` :
    `<span class="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">Pending</span>`;

  return `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2">
        <a href="https://www.amazon.co.uk/dp/${item.asin}" target="_blank" class="text-blue-600 hover:underline font-mono">
          ${item.asin}
        </a>
      </td>
      <td class="p-2 max-w-xs truncate" title="${escapeHtml(item.title || '')}">${escapeHtml((item.title || '').substring(0, 40))}...</td>
      <td class="p-2 text-right">${item.current_price ? '£' + safeToFixed(item.current_price) : '-'}</td>
      <td class="p-2 text-right">${item.scenario_bom_cost ? '£' + safeToFixed(item.scenario_bom_cost) : '-'}</td>
      <td class="p-2 text-right ${marginColor} font-semibold">
        ${item.opportunity_margin ? (item.opportunity_margin * 100).toFixed(1) + '%' : '-'}
      </td>
      <td class="p-2 text-center">
        <span class="px-2 py-1 text-xs rounded ${scoreColor}">${item.opportunity_score}</span>
      </td>
      <td class="p-2 text-center">${statusBadge}</td>
      <td class="p-2 text-center">
        <div class="flex gap-1 justify-center">
          <button onclick="openAsinDetailModal(${item.asin_entity_id})" class="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">View</button>
          ${!item.is_converted ? `
            <button onclick="openScenarioBomModal(${item.asin_entity_id})" class="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600">BOM</button>
            <button onclick="openConvertToListingModal(${item.asin_entity_id})" class="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600">Convert</button>
          ` : ''}
          <button onclick="toggleAsinTracking(${item.asin_entity_id}, false)" class="px-2 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500">Untrack</button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Open ASIN detail modal
 */
async function openAsinDetailModal(asinEntityId) {
  const details = await getAsinDetails(asinEntityId);
  if (!details) return;

  currentAsinEntityId = asinEntityId;
  const features = details.features || {};
  const keepa = details.latest_keepa?.parsed_json?.metrics || {};

  const modalHtml = `
    <div id="asin-detail-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div class="p-4 border-b flex justify-between items-center">
          <h3 class="text-lg font-semibold">ASIN Details: ${details.asin}</h3>
          <button onclick="closeAsinDetailModal()" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
        </div>
        <div class="p-4">
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h4 class="font-semibold mb-2">Basic Info</h4>
              <div class="text-sm space-y-1">
                <p><span class="text-gray-500">Title:</span> ${escapeHtml(details.title || 'N/A')}</p>
                <p><span class="text-gray-500">Brand:</span> ${escapeHtml(details.brand || 'N/A')}</p>
                <p><span class="text-gray-500">Category:</span> ${escapeHtml(details.category || 'N/A')}</p>
                <p><span class="text-gray-500">Marketplace:</span> ${escapeHtml(details.marketplace_name)}</p>
              </div>
            </div>
            <div>
              <h4 class="font-semibold mb-2">Keepa Metrics</h4>
              <div class="text-sm space-y-1">
                <p><span class="text-gray-500">Current Price:</span> ${keepa.price_current ? '£' + safeToFixed(keepa.price_current) : 'N/A'}</p>
                <p><span class="text-gray-500">90d Median:</span> ${keepa.price_median_90d ? '£' + safeToFixed(keepa.price_median_90d) : 'N/A'}</p>
                <p><span class="text-gray-500">Competitors:</span> ${keepa.offers_count_current || 'N/A'}</p>
                <p><span class="text-gray-500">Sales Rank:</span> ${keepa.sales_rank_current || 'N/A'}</p>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h4 class="font-semibold mb-2">Scenario Economics</h4>
              <div class="text-sm space-y-1">
                <p><span class="text-gray-500">BOM Cost:</span> ${features.scenario_bom_cost_ex_vat ? '£' + safeToFixed(features.scenario_bom_cost_ex_vat) : 'Not set'}</p>
                <p><span class="text-gray-500">Est. Profit:</span> ${features.opportunity_profit ? '£' + safeToFixed(features.opportunity_profit) : 'N/A'}</p>
                <p><span class="text-gray-500">Est. Margin:</span> ${features.opportunity_margin ? (features.opportunity_margin * 100).toFixed(1) + '%' : 'N/A'}</p>
              </div>
            </div>
            <div>
              <h4 class="font-semibold mb-2">Tracking Status</h4>
              <div class="text-sm space-y-1">
                <p><span class="text-gray-500">Tracked:</span> ${details.is_tracked ? 'Yes' : 'No'}</p>
                <p><span class="text-gray-500">Tracked Since:</span> ${details.tracked_at ? new Date(details.tracked_at).toLocaleDateString() : 'N/A'}</p>
                <p><span class="text-gray-500">Converted:</span> ${details.listing_id ? 'Yes' : 'No'}</p>
                ${details.listing_id ? `<p><span class="text-gray-500">Listing ID:</span> ${details.listing_id}</p>` : ''}
              </div>
            </div>
          </div>
          <div class="flex gap-2 mt-4 pt-4 border-t">
            ${!details.is_tracked ? `<button onclick="toggleAsinTracking(${asinEntityId}, true); closeAsinDetailModal();" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Add to Research Pool</button>` : ''}
            ${!details.listing_id && details.is_tracked ? `
              <button onclick="closeAsinDetailModal(); openScenarioBomModal(${asinEntityId});" class="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600">Set Scenario BOM</button>
              <button onclick="closeAsinDetailModal(); openConvertToListingModal(${asinEntityId});" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">Convert to Listing</button>
            ` : ''}
            <button onclick="refreshAsinData(${asinEntityId})" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">Refresh Data</button>
          </div>
        </div>
      </div>
    </div>
  `;

  closeAsinDetailModal();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeAsinDetailModal() {
  const modal = document.getElementById('asin-detail-modal');
  if (modal) modal.remove();
}

async function refreshAsinData(asinEntityId) {
  try {
    await fetch(`/api/v2/asins/${asinEntityId}/keepa/refresh`, { method: 'POST' });
    alert('Data refresh jobs queued. Refresh the page in a few moments.');
  } catch (error) {
    alert('Error refreshing data: ' + error.message);
  }
}

/**
 * Open scenario BOM modal for an ASIN
 */
async function openScenarioBomModal(asinEntityId) {
  currentAsinEntityId = asinEntityId;

  const bomRes = await fetch(`/api/v2/asins/${asinEntityId}/bom`);
  const bomData = await bomRes.json();
  const existingBom = bomData.bom;

  const componentsRes = await fetch('/api/v2/components');
  const componentsData = await componentsRes.json();
  const components = componentsData.items || [];

  const modalHtml = `
    <div id="scenario-bom-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div class="p-4 border-b flex justify-between items-center">
          <h3 class="text-lg font-semibold">Scenario BOM ${existingBom ? '(v' + existingBom.version + ')' : ''}</h3>
          <button onclick="closeScenarioBomModal()" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
        </div>
        <div class="p-4">
          <div id="scenario-bom-lines" class="space-y-2 mb-4">
            ${existingBom && existingBom.lines.length > 0 ? existingBom.lines.map((line, idx) => `
              <div class="flex gap-2 items-center bom-line" data-idx="${idx}">
                <select class="flex-1 p-2 border rounded bom-component-select">
                  ${components.map(c => `<option value="${c.id}" ${c.id === line.component_id ? 'selected' : ''}>${escapeHtml(c.name)} (£${safeToFixed(c.unit_cost_ex_vat)})</option>`).join('')}
                </select>
                <input type="number" class="w-20 p-2 border rounded bom-quantity" value="${line.quantity}" min="0.01" step="0.01" placeholder="Qty">
                <input type="number" class="w-20 p-2 border rounded bom-wastage" value="${(line.wastage_rate * 100).toFixed(1)}" min="0" step="0.1" placeholder="Waste%">
                <button onclick="this.closest('.bom-line').remove()" class="px-2 py-1 bg-red-500 text-white rounded text-sm">x</button>
              </div>
            `).join('') : '<p class="text-gray-500 text-sm">No BOM lines. Add components below.</p>'}
          </div>

          <div class="flex gap-2 mb-4">
            <select id="new-bom-component" class="flex-1 p-2 border rounded">
              <option value="">Select component to add...</option>
              ${components.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (£${safeToFixed(c.unit_cost_ex_vat)})</option>`).join('')}
            </select>
            <button onclick="addScenarioBomLine()" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Add Line</button>
          </div>

          ${existingBom ? `<div class="bg-gray-50 p-3 rounded mb-4"><p class="text-sm"><span class="text-gray-500">Current Total:</span> <span class="font-semibold">£${safeToFixed(existingBom.total_cost_ex_vat)}</span></p></div>` : ''}

          <div class="flex gap-2 mt-4 pt-4 border-t">
            <button onclick="saveScenarioBom()" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">Save BOM</button>
            <button onclick="closeScenarioBomModal()" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  closeScenarioBomModal();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function addScenarioBomLine() {
  const componentSelect = document.getElementById('new-bom-component');
  const componentId = componentSelect.value;
  if (!componentId) { alert('Please select a component'); return; }

  const container = document.getElementById('scenario-bom-lines');
  const emptyMsg = container.querySelector('p.text-gray-500');
  if (emptyMsg) emptyMsg.remove();

  const idx = container.querySelectorAll('.bom-line').length;
  const lineHtml = `
    <div class="flex gap-2 items-center bom-line" data-idx="${idx}">
      <select class="flex-1 p-2 border rounded bom-component-select">
        ${Array.from(componentSelect.options).filter(o => o.value).map(o =>
          `<option value="${o.value}" ${o.value === componentId ? 'selected' : ''}>${escapeHtml(o.text)}</option>`
        ).join('')}
      </select>
      <input type="number" class="w-20 p-2 border rounded bom-quantity" value="1" min="0.01" step="0.01" placeholder="Qty">
      <input type="number" class="w-20 p-2 border rounded bom-wastage" value="0" min="0" step="0.1" placeholder="Waste%">
      <button onclick="this.closest('.bom-line').remove()" class="px-2 py-1 bg-red-500 text-white rounded text-sm">x</button>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', lineHtml);
  componentSelect.value = '';
}

async function saveScenarioBom() {
  const lines = [];
  document.querySelectorAll('#scenario-bom-lines .bom-line').forEach(lineEl => {
    const componentId = lineEl.querySelector('.bom-component-select').value;
    const quantity = parseFloat(lineEl.querySelector('.bom-quantity').value) || 0;
    const wastagePercent = parseFloat(lineEl.querySelector('.bom-wastage').value) || 0;

    if (componentId && quantity > 0) {
      lines.push({ component_id: parseInt(componentId, 10), quantity, wastage_rate: wastagePercent / 100 });
    }
  });

  if (lines.length === 0) { alert('Please add at least one BOM line'); return; }

  try {
    const res = await fetch(`/api/v2/asins/${currentAsinEntityId}/bom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save BOM');

    alert('Scenario BOM saved! Total cost: £' + safeToFixed(data.total_cost_ex_vat));
    closeScenarioBomModal();
    await loadResearchPool();
  } catch (error) {
    alert('Error saving BOM: ' + error.message);
  }
}

function closeScenarioBomModal() {
  const modal = document.getElementById('scenario-bom-modal');
  if (modal) modal.remove();
}

/**
 * Open convert to listing modal
 */
async function openConvertToListingModal(asinEntityId) {
  currentAsinEntityId = asinEntityId;
  const details = await getAsinDetails(asinEntityId);
  if (!details) return;

  const keepa = details.latest_keepa?.parsed_json?.metrics || {};

  const modalHtml = `
    <div id="convert-listing-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div class="p-4 border-b flex justify-between items-center">
          <h3 class="text-lg font-semibold">Convert ASIN to Listing</h3>
          <button onclick="closeConvertListingModal()" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
        </div>
        <div class="p-4">
          <div class="mb-4">
            <p class="text-sm text-gray-600 mb-2">Converting: <span class="font-mono font-semibold">${details.asin}</span></p>
            <p class="text-sm text-gray-500">${escapeHtml(details.title || 'No title')}</p>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">SKU *</label>
              <input type="text" id="convert-sku" class="w-full p-2 border rounded" placeholder="Enter unique SKU" required>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Title (optional)</label>
              <input type="text" id="convert-title" class="w-full p-2 border rounded" value="${escapeHtml(details.title || '')}">
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Price (inc VAT)</label>
                <input type="number" id="convert-price" class="w-full p-2 border rounded" value="${keepa.price_current || ''}" step="0.01" min="0">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Initial Stock</label>
                <input type="number" id="convert-quantity" class="w-full p-2 border rounded" value="0" min="0">
              </div>
            </div>
            <div class="flex items-center">
              <input type="checkbox" id="convert-copy-bom" checked class="mr-2">
              <label for="convert-copy-bom" class="text-sm text-gray-700">Copy scenario BOM to listing BOM</label>
            </div>
          </div>
          <div class="flex gap-2 mt-6 pt-4 border-t">
            <button onclick="convertAsinToListing()" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">Create Listing</button>
            <button onclick="closeConvertListingModal()" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  closeConvertListingModal();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function convertAsinToListing() {
  const sku = document.getElementById('convert-sku').value.trim();
  const title = document.getElementById('convert-title').value.trim();
  const priceIncVat = parseFloat(document.getElementById('convert-price').value) || 0;
  const quantity = parseInt(document.getElementById('convert-quantity').value, 10) || 0;
  const copyBom = document.getElementById('convert-copy-bom').checked;

  if (!sku) { alert('SKU is required'); return; }

  try {
    const res = await fetch(`/api/v2/asins/${currentAsinEntityId}/convert-to-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, title: title || undefined, price_inc_vat: priceIncVat || undefined, available_quantity: quantity, copy_scenario_bom: copyBom })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to convert');

    alert('Listing created successfully!\n\nListing ID: ' + data.listing_id + '\nSKU: ' + data.sku + '\nBOM copied: ' + (data.bom_copied ? 'Yes' : 'No'));
    closeConvertListingModal();
    await loadResearchPool();
  } catch (error) {
    alert('Error converting to listing: ' + error.message);
  }
}

function closeConvertListingModal() {
  const modal = document.getElementById('convert-listing-modal');
  if (modal) modal.remove();
}

/**
 * Render ASIN analyzer input section
 */
function renderAsinAnalyzerInput(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="bg-white p-4 rounded-lg shadow mb-4">
      <h3 class="font-semibold mb-3">Analyze New ASIN</h3>
      <div class="flex gap-2">
        <input type="text" id="analyze-asin-input" class="flex-1 p-2 border rounded font-mono uppercase" placeholder="Enter ASIN (e.g., B08N5WRWNW)" maxlength="10">
        <select id="analyze-marketplace-select" class="p-2 border rounded">
          <option value="1">UK (amazon.co.uk)</option>
          <option value="2">US (amazon.com)</option>
          <option value="3">DE (amazon.de)</option>
        </select>
        <button onclick="handleAnalyzeAsin()" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Analyze</button>
      </div>
      <div id="analyze-result" class="mt-3"></div>
    </div>
  `;
}

async function handleAnalyzeAsin() {
  const asin = document.getElementById('analyze-asin-input').value;
  const marketplaceId = parseInt(document.getElementById('analyze-marketplace-select').value, 10);
  const resultEl = document.getElementById('analyze-result');

  resultEl.innerHTML = '<p class="text-gray-500">Analyzing...</p>';
  const result = await analyzeAsin(asin, marketplaceId);

  if (result) {
    resultEl.innerHTML = `
      <div class="p-3 bg-green-50 border border-green-200 rounded">
        <p class="font-semibold text-green-700">Analysis started!</p>
        <p class="text-sm text-gray-600">ASIN Entity ID: ${result.asin_entity_id}</p>
        <div class="mt-2 flex gap-2">
          <button onclick="openAsinDetailModal(${result.asin_entity_id})" class="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">View Details</button>
          <button onclick="toggleAsinTracking(${result.asin_entity_id}, true)" class="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600">Add to Research Pool</button>
        </div>
      </div>
    `;
    document.getElementById('analyze-asin-input').value = '';
  } else {
    resultEl.innerHTML = '<p class="text-red-600">Analysis failed. Check the console for details.</p>';
  }
}
