const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const SHARED_DIR = path.join(__dirname, '..', 'FpCardinal', 'shared');
const ORDERS_FILE = path.join(SHARED_DIR, 'orders.json');
const CUSTOMERS_FILE = path.join(SHARED_DIR, 'customers.json');

app.get('/api/stats', async (req, res) => {
    try {
        const ordersData = await fs.readFile(ORDERS_FILE, 'utf8').catch(() => '[]');
        const customersData = await fs.readFile(CUSTOMERS_FILE, 'utf8').catch(() => '[]');

        const orders = JSON.parse(ordersData);
        const customers = JSON.parse(customersData);

        res.json({
            totalOrders: orders.length,
            pendingOrders: orders.filter(o => o.status === 'pending').length,
            completedOrders: orders.filter(o => o.status === 'completed').length,
            uniqueCustomers: customers.length,
            lastOrder: orders[orders.length - 1] || null
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.listen(PORT, () => {
    console.log(`[Dashboard] Server running at http://localhost:${PORT}`);
});
