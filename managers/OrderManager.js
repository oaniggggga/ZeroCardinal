const MinecraftService = require('../services/MinecraftService');
const DatabaseManager = require('../managers/DatabaseManager');
const Logger = require('../utils/Logger');
const { Order, OrderQueue } = require('../managers/Order');
const MinecraftValidator = require('../utils/MinecraftValidator');
const config = require('../config/default.json');
const rootConfig = require('../config.json');
const SocketService = require('../services/SocketService');

class OrderManager {
    // ... constructor ...
    constructor() {
        this.orderQueue = new OrderQueue();
        this.dialogStates = new Map();
        this.guestWelcomeSent = new Set();
        this.isProcessing = false;
        this.isPolling = false; // Prevents overlapping poll loops
        this.isCheckingMessages = false; // Locking for message processing
        this.pollInterval = null;
    }

    getStats() {
        return this.orderQueue.getStats();
    }

    async start() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        Logger.info('OrderManager started (DB Mode + Socket)');

        DatabaseManager.init();
        await this.loadState();

        // Start polling loop (backup)
        this.pollInterval = setInterval(() => this.pollLoop(), config.orders.pollInterval || 2000);

        // Listen for Socket signals
        SocketService.on('order', () => {
            Logger.info('Socket Signal: New Order');
            this.checkNewOrders();
        });

        SocketService.on('message', () => {
            Logger.info('Socket Signal: New Message');
            this.checkMessages();
        });

    }

    async pollLoop() {
        if (this.isPolling) return; // Skip if previous loop hasn't finished
        this.isPolling = true;
        try {
            await this.syncLegacyOrders();
            await this.checkNewOrders();
            await this.checkMessages();
        } catch (e) {
            Logger.error('Error in poll loop:', e);
        } finally {
            this.isPolling = false;
        }
    }

    async syncLegacyOrders() {
        const fs = require('fs');
        const ordersPath = path.join(__dirname, '..', config.paths.sharedDir, 'orders.json');
        if (!fs.existsSync(ordersPath)) return;

        try {
            const data = fs.readFileSync(ordersPath, 'utf8');
            const orders = JSON.parse(data);
            for (const order of orders) {
                if (!DatabaseManager.getOrder(order.id)) {
                    Logger.info(`Syncing legacy/manual order: #${order.id}`);
                    DatabaseManager.createOrder({
                        id: order.id,
                        username: order.username,
                        amount: order.amount,
                        description: order.description,
                        status: order.status || 'pending',
                        createdAt: order.timestamp * 1000 || Date.now(),
                        updatedAt: Date.now()
                    });
                } else if (order.status === 'processing' || order.status === 'completed') {
                    // Update status if changed in JSON (for manual testing via JSON edit)
                    DatabaseManager.updateOrder(order.id, { status: order.status });
                }
            }
        } catch (e) {
            Logger.error('Error syncing orders.json:', e);
        }
    }

    async loadState() {
        const dialogs = DatabaseManager.getAllDialogs();
        for (const d of dialogs) {
            const orderData = d.data;
            const order = new Order(orderData.id, orderData.username, orderData.amount, orderData.description);
            Object.assign(order, orderData);
            this.dialogStates.set(d.order_id, { step: d.step, order });
        }

        const pendingOrders = DatabaseManager.getPendingOrders();
        for (const row of pendingOrders) {
            if (!this.dialogStates.has(row.id) && !this.orderQueue.findOrder(row.id)) {
                const order = new Order(row.id, row.username, row.amount, row.description);
                order.status = row.status;
                order.nickname = row.nickname;
                order.createdAt = row.created_at;
                this.orderQueue.add(order);
            }
        }
        Logger.info(`Loaded ${this.dialogStates.size} dialogs and ${this.orderQueue.queue.length} pending orders`);
    }

    formatMessage(template, vars) {
        return template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : _);
    }

    async checkNewOrders() {
        const pendingOrders = DatabaseManager.getPendingOrders();
        for (const row of pendingOrders) {
            if (this.dialogStates.has(row.id) || this.orderQueue.findOrder(row.id)) continue;

            Logger.info(`New order detected: #${row.id}`);
            const order = new Order(row.id, row.username, row.amount, row.description);
            order.status = row.status;
            order.createdAt = row.created_at;

            const position = this.orderQueue.add(order);

            if (position === 0) {
                await this.startOrderDialog(order);
            } else {
                await this.notifyQueuePosition(order, position);
            }
        }
    }

    async startOrderDialog(order) {
        Logger.info(`Starting dialog for order #${order.id}. Status: ${order.status}`);

        if (order.nickname) {
            if (order.status !== 'confirming') {
                order.status = 'confirming';
                DatabaseManager.updateOrder(order.id, { status: 'confirming', nickname: order.nickname });

                const confirmMsg = this.formatMessage(config.messages.dialog.confirm, {
                    id: order.id,
                    amount: MinecraftValidator.formatAmount(order.amount * 1000000),
                    nickname: order.nickname
                });
                this.sendFunPayMessage(order.username, confirmMsg, order.id);
            }
            this.setDialogState(order.id, 'waiting_confirmation', order);
        } else if (!order.status || order.status === 'pending' || order.status === 'processing') {
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted' });

            let welcomeMsg = this.formatMessage(config.messages.dialog.welcome, { id: order.id });
            if (Date.now() - order.createdAt > config.orders.queueNotifyThreshold) {
                welcomeMsg = this.formatMessage(config.messages.dialog.welcomeQueue, { id: order.id });
            }
            this.sendFunPayMessage(order.username, welcomeMsg, order.id);
            this.setDialogState(order.id, 'waiting_nickname', order);
        } else if (order.status === 'contacted') {
            this.setDialogState(order.id, 'waiting_nickname', order);
        }

        if (order.timeoutId) clearTimeout(order.timeoutId);
        order.timeoutId = setTimeout(() => this.handleOrderTimeout(order), config.orders.dialogTimeout);
    }

    setDialogState(orderId, step, order) {
        this.dialogStates.set(orderId, { step, order });
        const orderCopy = { ...order };
        delete orderCopy.timeoutId;
        DatabaseManager.saveDialog(orderId, step, orderCopy);
    }

    async handleOrderTimeout(order) {
        Logger.info(`Timeout for order #${order.id}`);
        if (!this.dialogStates.has(order.id)) return;

        const timeoutMessage = this.formatMessage(config.messages.dialog.timeout, { id: order.id });
        this.sendFunPayMessage(order.username, timeoutMessage, order.id);

        const nextOrder = this.orderQueue.moveCurrentToEnd();

        order.status = 'pending';
        DatabaseManager.updateOrder(order.id, { status: 'pending' });

        this.dialogStates.delete(order.id);
        DatabaseManager.deleteDialog(order.id);

        if (nextOrder) await this.startOrderDialog(nextOrder);

        const position = this.orderQueue.getPosition(order.id);
        if (position > 0) this.notifyQueuePosition(order, position);
    }

    async notifyQueuePosition(order, position) {
        const msg = this.formatMessage(config.messages.dialog.queuePosition, { id: order.id, position });
        this.sendFunPayMessage(order.username, msg, order.id);
    }

    async checkMessages() {
        if (this.isCheckingMessages) return;
        this.isCheckingMessages = true;
        try {
            const messages = DatabaseManager.getUnprocessedMessages();
            for (const msg of messages) {
                if (DatabaseManager.claimMessage(msg.id)) {
                    await this.handleFunPayMessage(msg);
                }
            }
        } catch (e) {
            Logger.error('Error in checkMessages:', e);
        } finally {
            this.isCheckingMessages = false;
        }
    }

    async handleFunPayMessage(msg) {
        let targetOrderId = null;
        for (const [orderId, state] of this.dialogStates.entries()) {
            if (state.order.username === msg.username) {
                targetOrderId = orderId;
                break;
            }
        }

        if (targetOrderId) {
            await this.handleUserMessage(targetOrderId, msg.username, msg.message);
        } else {
            const isCommand = await this.processCommand(msg.username, msg.message);
            if (!isCommand) {
                Logger.chat(`[${msg.username}] ${msg.message}`); // Log incoming message

                // Check if user has ANY pending/processing orders even if not in dialogStates yet
                const activeOrder = DatabaseManager.getActiveOrderForUser(msg.username);

                if (activeOrder) {
                    Logger.info(`Found active order for ${msg.username} (ID: ${activeOrder.id}, Status: ${activeOrder.status}). Triggering checkNewOrders.`);
                    // Force pick up this order
                    await this.checkNewOrders();
                } else if (!DatabaseManager.isCustomer(msg.username) && !this.guestWelcomeSent.has(msg.username)) {
                    this.sendGuestWelcome(msg.username);
                }
            }
        }
    }

    async handleUserMessage(orderId, username, message) {
        Logger.chat(`[${username}] ${message}`); // Log incoming message

        // Handle !change command globally for any dialog state
        if (message.trim().toLowerCase() === '!change' || message.trim().toLowerCase() === '!сменить') {
            const state = this.dialogStates.get(orderId);
            if (state) {
                const order = state.order;
                this.sendFunPayMessage(order.username, config.messages.dialog.changeNickname, order.id);
                order.status = 'contacted';
                DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
                this.setDialogState(order.id, 'waiting_nickname', order);
                return;
            }
        }

        const state = this.dialogStates.get(orderId);
        if (!state) return;

        if (state.step === 'waiting_nickname') {
            await this.handleNicknameInput(state.order, message);
        } else if (state.step === 'waiting_confirmation') {
            await this.handleConfirmation(state.order, message);
        }
    }

    async handleNicknameInput(order, nickname) {
        const text = nickname.trim().toLowerCase();
        if (config.messages.stopWords.some(w => text.includes(w)) && text.length > 3) {
            this.sendFunPayMessage(order.username, "🤖 Вижу, что вам, возможно, не нужна выдача. Я позвал администратора.", order.id);
            this.sendAlert(this.formatMessage(config.messages.dialog.adminAlert, { id: order.id, text: text }));
            this.dialogStates.delete(order.id);
            DatabaseManager.deleteDialog(order.id);
            return;
        }

        const validation = MinecraftValidator.isValidUsername(nickname);
        if (!validation.valid) {
            order.attempts = (order.attempts || 0) + 1;
            if (order.attempts >= 3) {
                this.sendFunPayMessage(order.username, config.messages.dialog.unknownNickname, order.id);
                this.sendAlert(`⚠️ Не валидный ник (3 попытки) Order #${order.id}: ${text}`);
                this.dialogStates.delete(order.id);
                DatabaseManager.deleteDialog(order.id);
                return;
            }
            this.sendFunPayMessage(order.username, this.formatMessage(config.messages.dialog.retryNickname, { error: MinecraftValidator.getErrorMessage(validation) }), order.id);
            return;
        }

        order.attempts = 0;
        order.nickname = validation.username;
        order.status = 'confirming';
        DatabaseManager.updateOrder(order.id, { status: 'confirming', nickname: order.nickname });

        const confirmMsg = this.formatMessage(config.messages.dialog.confirmNickname, {
            nickname: order.nickname,
            amount: MinecraftValidator.formatAmount(order.amount * 1000000)
        });
        this.sendFunPayMessage(order.username, confirmMsg, order.id);

        this.setDialogState(order.id, 'waiting_confirmation', order);
    }

    async handleConfirmation(order, message) {
        const state = this.dialogStates.get(order.id);
        if (state && state.isPaying) {
            Logger.info(`Order #${order.id} is already paying. Ignoring confirmation.`);
            return;
        }

        const response = message.toLowerCase().replace(/[\s\uFEFF\xA0]+/g, '');
        if (['да', 'yes', '+'].includes(response)) {
            order.confirmed = true;
            if (state) state.isPaying = true; // Lock
            await this.processOrder(order);
            if (state) state.isPaying = false; // Unlock (though usually order is done)
        } else if (['нет', 'no', '-', 'отмена'].includes(response)) {
            // ... rest same
            this.sendFunPayMessage(order.username, config.messages.dialog.cancel, order.id);
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
            this.setDialogState(order.id, 'waiting_nickname', order);
        } else {
            this.sendFunPayMessage(order.username, config.messages.dialog.askYesNo, order.id);
        }
    }

    async processOrder(order) {
        Logger.info(`Processing order #${order.id}`);

        try {
            DatabaseManager.updateOrder(order.id, { status: 'delivering' });

            const amount = order.amount * 1000000;
            const payCommand = `/pay ${order.nickname} ${amount}`;

            let attempts = 0;
            const maxAttempts = 5;
            let success = false;

            while (attempts < maxAttempts && !success) {
                if (order._abort) {
                    Logger.info(`Order #${order.id} aborted by admin.`);
                    return; // Stop processing immediately
                }

                attempts++;
                Logger.info(`Payment attempt ${attempts}/${maxAttempts} for order #${order.id}`);

                MinecraftService.chat(payCommand);

                // Verification Promise
                const result = await new Promise((resolve) => {
                    if (!MinecraftService.bot) return resolve({ success: false, error: "Bot not connected" });

                    let resolved = false;
                    let timeout = setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            MinecraftService.bot.removeListener('message', messageHandler);
                            resolve({ success: false, error: "timeout" });
                        }
                    }, 5000);

                    const messageHandler = (msg) => {
                        const text = msg.toString();
                        // Success patterns
                        // [✔] Успешно! Игроку ... отправлено ...
                        if (text.includes('вы успешно отправили') ||
                            text.includes('Вы успешно перевели') ||
                            text.includes('Вы перевели') ||
                            text.includes('Успешно переведено') ||
                            (text.includes('Успешно!') && text.includes('отправлено'))) {

                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                MinecraftService.bot.removeListener('message', messageHandler);
                                resolve({ success: true });
                            }
                        }
                        // Failure patterns
                        else if (text.includes('Игрок не найден') || text.includes('не найден') || text.includes('недостаточно средств')) {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                MinecraftService.bot.removeListener('message', messageHandler);
                                resolve({ success: false, error: "not_found" });
                            }
                        }
                        // Confirmation pattern
                        else if (text.includes('Введите команду повторно') || text.includes('[⟲]')) {
                            Logger.info(`Server asked for confirmation. Resending pay command for order #${order.id}`);
                            // Extend timeout by 5 seconds
                            clearTimeout(timeout);
                            timeout = setTimeout(() => {
                                if (!resolved) {
                                    resolved = true;
                                    MinecraftService.bot.removeListener('message', messageHandler);
                                    resolve({ success: false, error: "timeout_after_confirm" });
                                }
                            }, 5000);
                            MinecraftService.chat(payCommand);
                        }
                    };

                    MinecraftService.bot.on('message', messageHandler);
                });

                if (result.success) {
                    success = true;
                    Logger.info(`Payment successful for order #${order.id}`);
                    const successMsg = this.formatMessage(config.messages.dialog.success, { amount: MinecraftValidator.formatAmount(amount) });
                    if (this.dialogStates.has(order.id)) {
                        this.sendFunPayMessage(order.username, successMsg, order.id);
                    }
                    DatabaseManager.updateOrder(order.id, { status: 'completed' });
                    this.orderQueue.completeCurrent(true);
                    this.dialogStates.delete(order.id);
                    DatabaseManager.deleteDialog(order.id);

                    const next = this.orderQueue.getCurrent();
                    if (next) await this.startOrderDialog(next);
                    return; // Exit function
                } else {
                    Logger.warn(`Payment attempt ${attempts} failed: ${result.error}`);
                    if (attempts < maxAttempts) {
                        let waitMsg = `⏳ Не вижу вас на сервере. Попытка ${attempts}/${maxAttempts}. Проверю снова через 20 сек...`;

                        if (result.error === 'timeout' || result.error === 'timeout_after_confirm') {
                            waitMsg = `⏳ Сервер долго отвечает (лаги?). Попытка ${attempts}/${maxAttempts}. Пробую еще раз через 20 сек...`;
                        } else if (result.error === 'not_found') {
                            waitMsg = `⏳ Сервер пишет "Игрок не найден". Попытка ${attempts}/${maxAttempts}. Зайдите на Anarchy 401! Проверю через 20 сек...`;
                        }

                        this.sendFunPayMessage(order.username, waitMsg, order.id);
                        await new Promise(r => setTimeout(r, 20000));
                    }
                }
            }

            // If we are here, all attempts failed
            Logger.warn(`All payment attempts failed for order #${order.id}`);
            const errorMsg = "❌ Игрок не найден на сервере после 5 попыток. Пожалуйста, проверьте ник и зайдите на Anarchy 401.";
            this.sendFunPayMessage(order.username, errorMsg, order.id);

            // Reset to nickname step
            order.status = 'contacted';
            DatabaseManager.updateOrder(order.id, { status: 'contacted', nickname: null });
            this.setDialogState(order.id, 'waiting_nickname', order);

        } catch (e) {
            Logger.error(`Error processing order #${order.id}: ${e.message}`);
        }
    }

    sendGuestWelcome(username) {
        if (this.guestWelcomeSent.has(username)) return;
        this.sendFunPayMessage(username, config.messages.dialog.guestWelcome);
        this.guestWelcomeSent.add(username);
        setTimeout(() => this.guestWelcomeSent.delete(username), config.orders.guestWelcomeTimeout || 86400000);
    }

    async processCommand(username, text) {
        const cmd = text.trim().toLowerCase();
        if (cmd === '!status' || cmd === '!статус') {
            const stats = this.orderQueue.getStats();
            this.sendFunPayMessage(username, this.formatMessage(config.messages.dialog.stats, { completed: stats.completed, queued: stats.queued }));
            return true;
        } else if (cmd === '!queue' || cmd === '!очередь') {
            const position = this.orderQueue.getPositionByUsername(username);
            if (position > 0) {
                const msg = this.formatMessage(config.messages.dialog.queueStatus, { position: position, ahead: position - 1 });
                this.sendFunPayMessage(username, msg);
            } else if (position === 0) {
                // Check if it's the current one being processed
                const current = this.orderQueue.getCurrent();
                if (current && current.username === username) {
                    this.sendFunPayMessage(username, "⏳ Ваш заказ выполняется прямо сейчас!");
                } else {
                    this.sendFunPayMessage(username, config.messages.dialog.notInQueue);
                }
            } else {
                this.sendFunPayMessage(username, config.messages.dialog.notInQueue);
            }
            return true;
        } else if (cmd === '!help' || cmd === '!помощь') {
            this.sendFunPayMessage(username, config.messages.dialog.help);
            return true;
        } else if (text === '!skip') {
            // Check admin
            if (rootConfig.admins && rootConfig.admins.includes(username)) {
                const currentOrder = this.orderQueue.getCurrent();
                if (currentOrder && currentOrder.status === 'delivering') {
                    Logger.info(`Admin ${username} skipped order #${currentOrder.id}`);
                    currentOrder._abort = true; // Signal to abort loop

                    this.sendFunPayMessage(username, this.formatMessage(config.messages.dialog.skipSuccess, { id: currentOrder.id }));

                    // Logic to move to next is handled by the loop exiting or we force completion handling?
                    // The loop usually sets status = 'completed' on success. 
                    // If we abort, we should probably mark it as skipped or failed?
                    // For now, let's treat "skip" as "cancel processing and move on", maybe mark as manual intervention needed or just effectively "cancelled".
                    // But usually "skip" means "mark as done/ignore and go next". 
                    // Let's set status to 'skipped' and move next.

                    DatabaseManager.updateOrder(currentOrder.id, { status: 'skipped' });
                    this.orderQueue.completeCurrent(false); // Remove from queue
                    this.dialogStates.delete(currentOrder.id);
                    DatabaseManager.deleteDialog(currentOrder.id);

                    // Trigger next
                    setTimeout(async () => {
                        const next = this.orderQueue.getCurrent();
                        if (next) await this.startOrderDialog(next);
                    }, 1000);

                } else {
                    this.sendFunPayMessage(username, "⛔ Сейчас нет активного заказа в процессе выдачи.");
                }
            } else {
                this.sendFunPayMessage(username, config.messages.dialog.adminOnly);
            }
            return true;
        } else if (cmd === '!balance' || cmd === '!баланс') {
            const balance = await MinecraftService.getBalance();
            const msg = this.formatMessage(config.messages.dialog.balance || "💰 Текущий баланс: {balance} монет.", { balance: balance.toLocaleString() });
            this.sendFunPayMessage(username, msg);
            return true;
        } else if (cmd === '!refund') {
            this.sendFunPayMessage(username, "Для возврата средств, пожалуйста, обратитесь к администратору или создайте тикет на FunPay.");
            return true;
        }
        return false;
    }

    sendFunPayMessage(username, message, orderId = null) {
        let nodeId = null;
        if (orderId) {
            // Try to look up node_id from active dialog state
            const state = this.dialogStates.get(orderId);
            if (state && state.order && state.order.node_id) {
                nodeId = state.order.node_id;
            } else {
                // Try from DB
                const order = DatabaseManager.getOrder(orderId);
                if (order && order.node_id) {
                    nodeId = order.node_id;
                }
            }
        }

        const payload = {
            type: 'message',
            username: username,
            message: message,
            order_id: orderId,
            node_id: nodeId, // Pass node_id to SocketService
            timestamp: Date.now()
        };
        // Save to DB first as backup/audit
        DatabaseManager.addRequest('message', payload);

        Logger.chat(`[Bot -> ${username}] ${message}`); // Log outgoing message

        // Send via Socket for instant delivery
        SocketService.sendFunPayMessage(username, message, orderId, nodeId);
    }

    sendAlert(message) {
        const payload = { message, timestamp: Date.now() };
        DatabaseManager.addRequest('alert', payload);
        SocketService.send({ type: 'alert', message });
    }
}

module.exports = new OrderManager();
