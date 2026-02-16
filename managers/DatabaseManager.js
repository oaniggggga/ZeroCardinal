const Database = require('better-sqlite3');
const path = require('path');
const Logger = require('../utils/Logger');
const config = require('../config/default.json');

class DatabaseManager {
    constructor() {
        this.dbPath = path.join(__dirname, '..', config.paths.sharedDir, 'data.db');
        this.db = null;
    }

    init() {
        try {
            Logger.info(`Initializing database at ${this.dbPath}`);
            this.db = new Database(this.dbPath); // { verbose: console.log } for debug
            this.db.pragma('journal_mode = WAL'); // Better concurrency
            this.createTables();
        } catch (error) {
            Logger.error('Failed to initialize database:', error);
            throw error;
        }
    }

    createTables() {
        const schema = `
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending',
                nickname TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                is_manual INTEGER DEFAULT 0,
                node_id INTEGER
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                is_incoming INTEGER DEFAULT 1,
                processed INTEGER DEFAULT 0,
                created_at INTEGER,
                node_id INTEGER,
                UNIQUE(username, message, created_at)
            );
            
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                payload JSON,
                processed INTEGER DEFAULT 0,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS dialogs (
                order_id TEXT PRIMARY KEY,
                step TEXT NOT NULL,
                data JSON,
                updated_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
            CREATE INDEX IF NOT EXISTS idx_orders_username ON orders(username);
            CREATE INDEX IF NOT EXISTS idx_messages_processed ON messages(processed);
            CREATE INDEX IF NOT EXISTS idx_requests_processed ON requests(processed);
        `;

        this.db.exec(schema);

        try {
            this.db.prepare("ALTER TABLE messages ADD COLUMN node_id INTEGER").run();
        } catch (e) {
            // Column likely exists
        }

        try {
            this.db.prepare("ALTER TABLE orders ADD COLUMN node_id INTEGER").run();
        } catch (e) {
            // Column likely exists
        }

        Logger.info('Database tables verified.');
    }

    // --- Orders ---

    getOrder(id) {
        return this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    }

    getPendingOrders() {
        return this.db.prepare("SELECT * FROM orders WHERE status IN ('pending', 'contacted', 'confirming', 'processing', 'delivering') ORDER BY created_at ASC").all();
    }

    getActiveOrderForUser(username) {
        return this.db.prepare("SELECT * FROM orders WHERE username = ? AND status IN ('pending', 'processing', 'confirming', 'contacted', 'delivering') LIMIT 1").get(username);
    }

    isCustomer(username) {
        const result = this.db.prepare("SELECT 1 FROM orders WHERE username = ? AND status = 'completed' LIMIT 1").get(username);
        return !!result;
    }

    getRecentOrders(limit = 50) {
        const stmt = this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?');
        return stmt.all(limit);
    }

    createOrder(order) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO orders (id, username, amount, description, status, created_at, updated_at)
            VALUES (@id, @username, @amount, @description, @status, @createdAt, @updatedAt)
        `);
        return stmt.run({
            id: order.id,
            username: order.username,
            amount: order.amount,
            description: order.description,
            status: order.status || 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }

    updateOrder(id, updates) {
        const keys = Object.keys(updates);
        if (keys.length === 0) return;

        const setClause = keys.map(key => `${key} = @${key}`).join(', ');
        const stmt = this.db.prepare(`UPDATE orders SET ${setClause}, updated_at = @updatedAt WHERE id = @id`);

        return stmt.run({
            ...updates,
            id,
            updatedAt: Date.now()
        });
    }

    deleteOrder(id) {
        return this.db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    }

    // --- Messages ---

    logMessage(username, message, isIncoming = true, nodeId = null) {
        const stmt = this.db.prepare('INSERT INTO messages (username, message, is_incoming, created_at, node_id) VALUES (?, ?, ?, ?, ?)');
        return stmt.run(username, message, isIncoming ? 1 : 0, Date.now(), nodeId);
    }

    getUnprocessedMessages() {
        return this.db.prepare('SELECT * FROM messages WHERE is_incoming = 1 AND processed = 0 ORDER BY created_at ASC').all();
    }

    claimMessage(id) {
        const stmt = this.db.prepare('UPDATE messages SET processed = 1 WHERE id = ? AND processed = 0');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    markMessageProcessed(id) {
        return this.db.prepare('UPDATE messages SET processed = 1 WHERE id = ?').run(id);
    }

    // --- Dialogs ---

    saveDialog(orderId, step, data = {}) {
        const stmt = this.db.prepare('INSERT OR REPLACE INTO dialogs (order_id, step, data, updated_at) VALUES (?, ?, ?, ?)');
        return stmt.run(orderId, step, JSON.stringify(data), Date.now());
    }

    deleteDialog(orderId) {
        return this.db.prepare('DELETE FROM dialogs WHERE order_id = ?').run(orderId);
    }

    getAllDialogs() {
        const rows = this.db.prepare('SELECT * FROM dialogs').all();
        return rows.map(row => ({
            order_id: row.order_id,
            step: row.step,
            data: JSON.parse(row.data)
        }));
    }

    addRequest(type, payload) {
        const stmt = this.db.prepare('INSERT INTO requests (type, payload, created_at) VALUES (?, ?, ?)');
        return stmt.run(type, JSON.stringify(payload), Date.now());
    }

    getPendingRequests() {
        return [];
    }
}

module.exports = new DatabaseManager();
