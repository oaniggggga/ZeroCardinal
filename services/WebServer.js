const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const Logger = require('../utils/Logger');
const OrderManager = require('../managers/OrderManager'); // To get stats
const MinecraftService = require('../services/MinecraftService'); // To get balance/status
const DatabaseManager = require('../managers/DatabaseManager');

class WebServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server);
        this.port = 3000;
        this.startTime = Date.now();
    }

    start() {
        // Serve static files
        this.app.use(express.static(path.join(__dirname, '../dashboard')));
        this.app.use(express.json());

        // --- API Endpoints ---

        this.app.get('/api/stats', async (req, res) => {
            const queueStats = OrderManager.getStats();
            const balance = await MinecraftService.getBalance();
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);

            res.json({
                online: MinecraftService.ready, // Use ready flag
                balance: balance,
                orders: queueStats,
                uptime: uptime
            });
        });

        this.app.get('/api/orders', (req, res) => {
            try {
                // Get last 50 orders
                const orders = DatabaseManager.getRecentOrders(50);
                res.json(orders);
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // Create Order
        this.app.post('/api/orders', (req, res) => {
            try {
                const { username, amount, description } = req.body;
                const id = `manual_${Date.now()}`;

                DatabaseManager.createOrder({
                    id,
                    username,
                    amount: parseFloat(amount),
                    description: description || 'Manual Order',
                    status: 'pending'
                });

                Logger.info(`[Dashboard] Created manual order for ${username} ($${amount})`);

                // Trigger OrderManager to pick it up immediately
                if (OrderManager.checkNewOrders) {
                    OrderManager.checkNewOrders();
                }

                res.json({ success: true, id });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // Delete Order
        this.app.delete('/api/orders/:id', (req, res) => {
            try {
                DatabaseManager.deleteOrder(req.params.id);
                Logger.info(`[Dashboard] Deleted order ${req.params.id}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // Reset Order
        this.app.post('/api/orders/:id/reset', (req, res) => {
            try {
                DatabaseManager.updateOrder(req.params.id, { status: 'pending' });
                // Also clear dialog to restart flow
                DatabaseManager.deleteDialog(req.params.id);
                Logger.info(`[Dashboard] Reset order ${req.params.id}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // Complete Order
        this.app.post('/api/orders/:id/complete', async (req, res) => {
            try {
                // DatabaseManager.updateOrder(req.params.id, { status: 'completed' });
                await OrderManager.completeOrder(req.params.id);
                Logger.info(`[Dashboard] Completed order ${req.params.id}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/restart', (req, res) => {
            Logger.warn('Restart requested via Dashboard');
            res.json({ success: true });

            // Allow response to send before exiting
            setTimeout(() => {
                process.exit(0); // PM2 will restart it
            }, 1000);
        });

        // --- Socket.io ---

        this.io.on('connection', (socket) => {
            // Send initial data
            socket.emit('log_history', Logger.getRecentLogs());
        });

        // Start listening
        this.server.listen(this.port, () => {
            Logger.info(`Web Dashboard running at http://localhost:${this.port}`);
        });
    }

    // Call this when a new log occurs
    broadcastLog(level, message) {
        if (this.io) {
            this.io.emit('log', {
                timestamp: new Date().toLocaleTimeString(),
                level: level,
                message: message
            });
        }
    }
}

module.exports = new WebServer();
