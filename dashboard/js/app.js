const socket = io();
const modal = new bootstrap.Modal(document.getElementById('createOrderModal'));

function showCreateOrderModal() {
    modal.show();
}

function hideCreateOrderModal() {
    modal.hide();
}

async function submitCreateOrder() {
    const username = document.getElementById('newOrderUser').value;
    const amount = document.getElementById('newOrderAmount').value;
    const description = document.getElementById('newOrderDesc').value;

    if (!username || !amount) return alert('Fill all fields');

    try {
        await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, amount, description })
        });
        modal.hide();
        fetchOrders();
    } catch (e) {
        alert('Error: ' + e);
    }
}

async function actionOrder(id, action) {
    if (!confirm(`Are you sure you want to ${action} this order?`)) return;
    await fetch(`/api/orders/${id}/${action}`, { method: 'POST' });
    fetchOrders();
}

async function deleteOrder(id) {
    if (!confirm(`Delete order ${id}?`)) return;
    await fetch(`/api/orders/${id}`, { method: 'DELETE' });
    fetchOrders();
}

// Stats update loop
setInterval(fetchStats, 2000);
fetchStats();
fetchOrders();

// Navigation
document.querySelectorAll('.list-group-item').forEach(item => {
    item.addEventListener('click', (e) => {
        // Only handle items with data-target
        if (!item.hasAttribute('data-target')) return;
        e.preventDefault();

        // Update active class
        document.querySelectorAll('.list-group-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Show view
        const target = item.getAttribute('data-target');
        document.getElementById('view-dashboard').style.display = 'none';
        document.getElementById('view-orders').style.display = 'none';
        document.getElementById('view-logs').style.display = 'none';

        document.getElementById(`view-${target}`).style.display = 'block';

        if (target === 'orders') fetchOrders();
    });
});

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        // Update Status
        const statusBadge = document.getElementById('bot-status');
        if (data.online) {
            statusBadge.textContent = "Online";
            statusBadge.className = "badge bg-success";
        } else {
            statusBadge.textContent = "Offline";
            statusBadge.className = "badge bg-danger";
        }

        // Update Balance
        document.getElementById('bot-balance').textContent = data.balance.toLocaleString();

        // Update Cards
        document.getElementById('stat-completed').textContent = data.orders.completed;
        document.getElementById('stat-failed').textContent = data.orders.failed;
        document.getElementById('stat-queued').textContent = data.orders.queued;

        // Uptime
        const h = Math.floor(data.uptime / 3600);
        const m = Math.floor((data.uptime % 3600) / 60);
        document.getElementById('stat-uptime').textContent = `${h}h ${m}m`;

    } catch (e) {
        console.error("Stats error", e);
    }
}

async function fetchOrders() {
    try {
        const res = await fetch('/api/orders');
        const data = await res.json();
        const tbody = document.getElementById('orders-table-body');
        tbody.innerHTML = '';

        data.forEach(order => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${order.id}</td>
                <td>${order.username}</td>
                <td>${order.amount}</td>
                <td><span class="badge ${getStatusBadge(order.status)}">${order.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-success me-1" onclick="actionOrder('${order.id}', 'complete')" title="Complete">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="actionOrder('${order.id}', 'reset')" title="Reset">
                        <i class="fas fa-sync"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteOrder('${order.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Orders error", e);
    }
}

function getStatusBadge(status) {
    if (status === 'completed') return 'bg-success';
    if (status === 'processing' || status === 'delivering') return 'bg-primary';
    if (status === 'pending') return 'bg-warning text-dark';
    return 'bg-secondary';
}

function restartBot() {
    if (confirm('Are you sure you want to restart the bot process?')) {
        fetch('/api/restart', { method: 'POST' });
        alert('Restart command sent. Reload page in 10 seconds.');
    }
}

// Logs
const logContainer = document.getElementById('console-logs');

socket.on('log', (log) => {
    addLog(log);
});

socket.on('log_history', (logs) => {
    logContainer.innerHTML = '';
    logs.forEach(addLog);
});

function addLog(log) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    let levelClass = 'log-info';
    if (log.level === 'error') levelClass = 'log-error';
    if (log.level === 'warn') levelClass = 'log-warn';

    div.innerHTML = `<span class="log-ts">[${log.timestamp}]</span><span class="${levelClass}">${log.message}</span>`;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
}
