const MinecraftService = require('./services/MinecraftService');
const OrderManager = require('./managers/OrderManager');
const Logger = require('./utils/Logger');
const config = require('./config/default.json');
const util = require('util');

async function main() {
    Logger.info('Starting ZeroCardinal...');

    try {
        // Start Order Manager (which starts BridgeService)
        await OrderManager.start();

        // Start Socket Service
        const SocketService = require('./services/SocketService');
        SocketService.start();

        // Start Web Dashboard
        const WebServer = require('./services/WebServer');
        WebServer.start();
        Logger.setWebServer(WebServer);

        // Connect Bot
        MinecraftService.createBot();

        // Optional: Wire up specific events if needed
        MinecraftService.on('chat', async (message, packet) => {
            const text = message.toLowerCase();
            if (text.includes('!status') || text.includes('!статус')) {
                const stats = OrderManager.getStats();
                const msg = config.messages.game.stats
                    .replace('${completed}', stats.completed)
                    .replace('${failed}', stats.failed)
                    .replace('${queued}', stats.queued);
                MinecraftService.chat(msg);
            } else if (text.includes('!balance') || text.includes('!баланс')) {
                const balance = await MinecraftService.getBalance();
                const msg = config.messages.game.balance
                    .replace('${balance}', balance.toLocaleString());
                MinecraftService.chat(msg);
            }
        });

    } catch (error) {
        Logger.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

main();

// Handle process termination
process.on('SIGINT', () => {
    Logger.info('Stopping...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    Logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
