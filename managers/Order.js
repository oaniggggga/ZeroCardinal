/**
 * Класс для управления заказами и очередью
 */
class Order {
    constructor(id, username, amount, description) {
        this.id = id;
        this.username = username;
        this.amount = amount;
        this.description = description;
        this.status = 'pending'; // pending, processing, completed, failed
        this.createdAt = Date.now();
        this.timeoutId = null;
        this.nickname = null; // Ник в Minecraft
        this.confirmed = false; // Подтверждение от покупателя
        this.attempts = 0;
    }

    /**
     * Проверяет, истек ли таймаут заказа (2 минуты)
     */
    isExpired() {
        return Date.now() - this.createdAt > 120000; // 2 минуты
    }

    /**
     * Получает время до истечения таймаута
     */
    getTimeLeft() {
        const elapsed = Date.now() - this.createdAt;
        const left = 120000 - elapsed;
        return Math.max(0, Math.floor(left / 1000)); // в секундах
    }
}

/**
 * Менеджер очереди заказов
 */
class OrderQueue {
    constructor() {
        this.current = null; // Текущий обрабатываемый заказ
        this.queue = []; // Очередь ожидающих заказов
        this.completed = []; // История выполненных заказов
        this.failed = []; // История проваленных заказов
    }

    /**
     * Добавляет заказ в очередь
     */
    add(order) {
        if (this.current === null) {
            this.current = order;
            order.status = 'processing';
            console.log(`[OrderQueue] Заказ #${order.id} начал обработку`);
            return 0; // Позиция 0 = сразу в обработку
        } else {
            this.queue.push(order);
            const position = this.queue.length;
            console.log(`[OrderQueue] Заказ #${order.id} добавлен в очередь, позиция #${position}`);
            return position;
        }
    }

    /**
     * Получает текущий заказ
     */
    getCurrent() {
        return this.current;
    }

    /**
     * Проверяет, есть ли текущий заказ
     */
    hasCurrent() {
        return this.current !== null;
    }

    /**
     * Завершает текущий заказ и переходит к следующему
     */
    completeCurrent(success = true) {
        if (this.current) {
            this.current.status = success ? 'completed' : 'failed';

            if (success) {
                this.completed.push(this.current);
                console.log(`[OrderQueue] Заказ #${this.current.id} успешно завершен`);
            } else {
                this.failed.push(this.current);
                console.log(`[OrderQueue] Заказ #${this.current.id} провален`);
            }

            // Очищаем таймаут
            if (this.current.timeoutId) {
                clearTimeout(this.current.timeoutId);
                this.current.timeoutId = null;
            }

            this.current = null;
        }

        // Переходим к следующему заказу
        return this.processNext();
    }

    /**
     * Перемещает текущий заказ в конец очереди (при таймауте)
     */
    moveCurrentToEnd() {
        if (this.current) {
            console.log(`[OrderQueue] Заказ #${this.current.id} перемещен в конец очереди`);
            this.current.status = 'pending';
            this.current.createdAt = Date.now(); // Сбрасываем таймер
            this.current.attempts++;

            // Очищаем таймаут
            if (this.current.timeoutId) {
                clearTimeout(this.current.timeoutId);
                this.current.timeoutId = null;
            }

            this.queue.push(this.current);
            this.current = null;

            return this.processNext();
        }
        return null;
    }

    /**
     * Обрабатывает следующий заказ из очереди
     */
    processNext() {
        if (this.queue.length > 0) {
            this.current = this.queue.shift();
            this.current.status = 'processing';
            console.log(`[OrderQueue] Начата обработка заказа #${this.current.id} из очереди`);
            return this.current;
        }
        return null;
    }

    /**
     * Получает позицию заказа в очереди
     */
    getPosition(orderId) {
        if (this.current && this.current.id === orderId) {
            return 0; // Текущий заказ
        }

        const index = this.queue.findIndex(order => order.id === orderId);
        return index >= 0 ? index + 1 : -1; // -1 если не найден
    }

    /**
     * Получает позицию в очереди по нику пользователя FunPay
     */
    getPositionByUsername(username) {
        if (this.current && this.current.username === username) {
            return 0; // Текущий
        }
        const index = this.queue.findIndex(order => order.username === username);
        return index >= 0 ? index + 1 : -1;
    }

    /**
     * Получает размер очереди
     */
    getQueueSize() {
        return this.queue.length;
    }

    /**
     * Получает статистику
     */
    getStats() {
        return {
            current: this.current ? 1 : 0,
            queued: this.queue.length,
            completed: this.completed.length,
            failed: this.failed.length,
            total: this.completed.length + this.failed.length
        };
    }

    /**
     * Находит заказ по ID
     */
    findOrder(orderId) {
        if (this.current && this.current.id === orderId) {
            return this.current;
        }

        return this.queue.find(order => order.id === orderId) || null;
    }

    /**
     * Удаляет заказ из очереди
     */
    removeOrder(orderId) {
        const index = this.queue.findIndex(order => order.id === orderId);
        if (index >= 0) {
            const removed = this.queue.splice(index, 1)[0];
            console.log(`[OrderQueue] Заказ #${orderId} удален из очереди`);
            return removed;
        }
        return null;
    }
}

module.exports = { Order, OrderQueue };
