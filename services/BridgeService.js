const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const Logger = require('../utils/Logger');
const config = require('../config/default.json');

class BridgeService extends EventEmitter {
    constructor() {
        super();
        this.baseDir = path.join(__dirname, '..', config.paths.sharedDir);
        this.files = {
            orders: path.join(this.baseDir, config.paths.ordersFile),
            requests: path.join(this.baseDir, config.paths.requestsFile),
            dialogs: path.join(this.baseDir, config.paths.dialogsFile),
            customers: path.join(this.baseDir, config.paths.customersFile),
            messages: path.join(this.baseDir, config.paths.messagesFile)
        };
        this.requestQueue = Promise.resolve();
        this.checkInterval = null;
        this.msgCheckInterval = null;
    }

    start() {
        this.checkInterval = setInterval(() => this.checkOrders(), config.orders.checkInterval || 5000);
        this.msgCheckInterval = setInterval(() => this.checkMessages(), config.orders.funpayCheckInterval || 3000);
        Logger.info('BridgeService started');
    }

    stop() {
        if (this.checkInterval) clearInterval(this.checkInterval);
        if (this.msgCheckInterval) clearInterval(this.msgCheckInterval);
        Logger.info('BridgeService stopped');
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async readJson(filePath) {
        try {
            if (!(await this.fileExists(filePath))) return null;
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            Logger.error(`Error reading ${filePath}: ${error.message}`);
            return null;
        }
    }

    async writeJson(filePath, data) {
        const tempFile = `${filePath}.tmp.${Date.now()}`;
        try {
            await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
            await fs.rename(tempFile, filePath);
            return true;
        } catch (error) {
            Logger.error(`Error writing ${filePath}: ${error.message}`);
            if (await this.fileExists(tempFile)) await fs.unlink(tempFile).catch(() => { });
            return false;
        }
    }

    // --- Orders ---

    async checkOrders() {
        const orders = await this.readJson(this.files.orders);
        if (orders && Array.isArray(orders)) {
            const pendingOrders = orders.filter(o => ['pending', 'contacted', 'confirming', 'delivering'].includes(o.status));
            if (pendingOrders.length > 0) {
                this.emit('orders', pendingOrders);
            }
        }
    }

    async updateOrderStatus(orderId, status, extraData = {}) {
        const tempFile = `${this.files.orders}.tmp.${Date.now()}`;
        try {
            if (!(await this.fileExists(this.files.orders))) return;
            const data = await fs.readFile(this.files.orders, 'utf8');
            const orders = JSON.parse(data);
            const order = orders.find(o => o.id === orderId);
            if (order) {
                if (status) order.status = status;
                Object.assign(order, extraData);
                await fs.writeFile(tempFile, JSON.stringify(orders, null, 2), 'utf8');
                await fs.rename(tempFile, this.files.orders);
                Logger.log('Bridge', `Order #${orderId} updated. Status: ${order.status}`);
            }
        } catch (e) {
            Logger.error(`Error updating order #${orderId}: ${e.message}`);
            if (await this.fileExists(tempFile)) await fs.unlink(tempFile).catch(() => { });
        }
    }

    // --- Messages ---

    async checkMessages() {
        const messages = await this.readJson(this.files.messages);
        if (messages && messages.length > 0) {
            this.emit('messages', messages);
            // Clear messages file
            await fs.writeFile(this.files.messages, '[]', 'utf8');
        }
    }

    async addRequest(request) {
        this.requestQueue = this.requestQueue.then(async () => {
            let requests = await this.readJson(this.files.requests) || [];
            if (!Array.isArray(requests)) requests = [];

            requests.push(request);

            await this.writeJson(this.files.requests, requests);
        });
        return this.requestQueue;
    }

    async sendFunPayMessage(username, message, orderId = null) {
        // Prevent self-message loop if config is available (passed from outside or read here)
        // For now, simple check

        const request = {
            type: 'message',
            username: username,
            message: message,
            order_id: orderId,
            timestamp: Date.now()
        };
        await this.addRequest(request);
        Logger.log('Bridge', `Message request added for ${username}`);
    }

    // --- Dialogs & Customers State ---

    async loadState() {
        const dialogs = await this.readJson(this.files.dialogs) || {};
        const customers = await this.readJson(this.files.customers) || [];
        return { dialogs, customers: new Set(customers) };
    }

    async saveState(dialogs, customers) {
        await this.writeJson(this.files.dialogs, dialogs);
        await this.writeJson(this.files.customers, [...customers]);
    }
}

module.exports = new BridgeService();
