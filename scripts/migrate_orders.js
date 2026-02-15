const fs = require('fs');
const path = require('path');
const DatabaseManager = require('../managers/DatabaseManager');
const config = require('../config/default.json');
const Logger = require('../utils/Logger');

async function migrate() {
    Logger.info('Starting migration...');

    // Initialize DB (creates tables)
    DatabaseManager.init();

    const ordersPath = path.join(__dirname, '..', config.paths.sharedDir, 'orders.json');

    if (!fs.existsSync(ordersPath)) {
        Logger.warn('orders.json not found. Skipping migration.');
        return;
    }

    const data = fs.readFileSync(ordersPath, 'utf8');
    const orders = JSON.parse(data);

    Logger.info(`Found ${orders.length} orders to migrate.`);

    let imported = 0;
    for (const order of orders) {
        try {
            // Check if exists
            const existing = DatabaseManager.getOrder(order.id);
            if (existing) {
                // Logger.info(`Order ${order.id} already exists. Skipping.`);
                continue;
            }

            DatabaseManager.createOrder({
                id: order.id,
                username: order.username,
                amount: order.amount,
                description: order.description,
                status: order.status || 'pending',
                nickname: order.nickname,
                createdAt: order.timestamp * 1000,
                updatedAt: order.completedAt || Date.now()
            });

            // If completedAt exists, we might want to update it specifically or trust createOrder handling
            // createOrder uses passed createdAt/updatedAt.
            // But my createOrder method expects object with these fields.
            // Let's check DatabaseManager.createOrder signature and implementation.
            /*
            createOrder(order) {
                const stmt = ...
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
            */
            // Wait, my implementation of createOrder overrides createdAt/updatedAt with Date.now()!
            // I should modify DatabaseManager.createOrder to accept them or use raw query here.
            // For migration, I want to preserve timestamps.
            // I'll update the order immediately after creation to set correct timestamps or use a raw query here.

            DatabaseManager.db.prepare('UPDATE orders SET created_at = ?, updated_at = ?, nickname = ? WHERE id = ?')
                .run(
                    order.timestamp * 1000 || Date.now(),
                    order.completedAt || Date.now(),
                    order.nickname || null,
                    order.id
                );

            imported++;
        } catch (e) {
            Logger.error(`Failed to import order ${order.id}: ${e.message}`);
        }
    }

    Logger.info(`Migration complete. Imported ${imported} orders.`);
}

migrate();
