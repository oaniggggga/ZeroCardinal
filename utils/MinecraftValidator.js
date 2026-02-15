/**
 * Валидатор для Minecraft ников и данных
 */
class MinecraftValidator {
    /**
     * Проверяет валидность ника Minecraft
     * Правила: 3-16 символов, только латиница, цифры и подчеркивание
     */
    static isValidUsername(username) {
        if (!username || typeof username !== 'string') {
            return { valid: false, error: 'Ник не указан' };
        }

        // Если есть пробелы, берем первое слово (игнорируем " /an307" и т.д.)
        let trimmed = username.trim().split(/\s+/)[0];

        // Удаляем невидимые символы
        trimmed = trimmed.replace(/[\uFEFF\xA0\u200B\u200C\u200D\u2060\u180E]+/g, '');

        // Проверка на кириллицу
        if (/[а-яА-ЯёЁ]/.test(trimmed)) {
            // Пытаемся исправить раскладку
            const fixed = this.fixLayout(trimmed);
            if (/^[A-Za-z0-9_]+$/.test(fixed)) {
                return { valid: true, username: fixed, warning: 'Раскладка исправлена' };
            }
            return { valid: false, error: 'Ник должен быть на английском! (Обнаружены русские буквы)' };
        }

        // Проверка длины
        if (trimmed.length < 3) {
            return {
                valid: false,
                error: 'Ник слишком короткий (минимум 3 символа)'
            };
        }

        if (trimmed.length > 16) {
            return {
                valid: false,
                error: 'Ник слишком длинный (максимум 16 символов). Отправьте ТОЛЬКО ник.'
            };
        }

        // Проверка формата (только латиница, цифры, подчеркивание)
        const regex = /^[A-Za-z0-9_]+$/;
        if (!regex.test(trimmed)) {
            // Логгируем коды символов для отладки
            const codes = trimmed.split('').map(c => `'${c}':${c.charCodeAt(0)}`).join(', ');
            console.log(`[Validator] Невалидный ник '${trimmed}'. Коды: ${codes}`);

            // Последняя попытка исправить раскладку
            const fixed = this.fixLayout(trimmed);
            if (/^[A-Za-z0-9_]+$/.test(fixed)) {
                return { valid: true, username: fixed, warning: 'Раскладка исправлена' };
            }

            return {
                valid: false,
                error: 'Ник содержит недопустимые символы (разрешены только английские буквы, цифры и _)'
            };
        }

        // Проверка на запрещенные ники
        const forbidden = ['admin', 'moderator', 'owner', 'console', 'server'];
        if (forbidden.includes(trimmed.toLowerCase())) {
            return {
                valid: false,
                error: 'Этот ник зарезервирован системой'
            };
        }

        return { valid: true, username: trimmed };
    }

    /**
     * Проверяет валидность суммы
     */
    static isValidAmount(amount) {
        if (amount === null || amount === undefined) {
            return { valid: false, error: 'Сумма не указана' };
        }

        const num = Number(amount);

        if (isNaN(num)) {
            return { valid: false, error: 'Сумма должна быть числом' };
        }

        if (num <= 0) {
            return { valid: false, error: 'Сумма должна быть больше нуля' };
        }

        if (num > 1000000000) {
            return { valid: false, error: 'Сумма слишком большая (максимум 1,000,000,000)' };
        }

        if (!Number.isInteger(num)) {
            return { valid: false, error: 'Сумма должна быть целым числом' };
        }

        return { valid: true, amount: num };
    }

    /**
     * Форматирует сумму для отображения
     */
    static formatAmount(amount) {
        return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Проверяет, достаточно ли баланса
     */
    static hasEnoughBalance(balance, required) {
        if (balance === null || balance === undefined) {
            return { valid: false, error: 'Баланс не определен' };
        }

        if (required === null || required === undefined) {
            return { valid: false, error: 'Требуемая сумма не определена' };
        }

        if (balance < required) {
            return {
                valid: false,
                error: `Недостаточно средств. Баланс: ${this.formatAmount(balance)}, требуется: ${this.formatAmount(required)}`,
                balance,
                required,
                shortage: required - balance
            };
        }

        return { valid: true, balance, required };
    }

    /**
     * Исправляет похожие русские буквы на английские (с, о, р, х, а, е, у, к, в, н, м)
     */
    static fixLayout(text) {
        const replacements = {
            'а': 'a', 'А': 'A',
            'в': 'b', 'В': 'B', // В -> B (визуально)
            'е': 'e', 'Е': 'E',
            'к': 'k', 'К': 'K',
            'м': 'm', 'М': 'M',
            'н': 'H', // Н -> H (визуально)
            'о': 'o', 'О': 'O',
            'р': 'p', 'Р': 'P',
            'с': 'c', 'С': 'C',
            'т': 'T', // Т -> T
            'у': 'y', 'У': 'y',
            'х': 'x', 'Х': 'X',
            'і': 'i', 'І': 'I' // Украинская i
        };

        return text.split('').map(char => replacements[char] || char).join('');
    }

    /**
     * Генерирует сообщение об ошибке валидации
     */
    static getErrorMessage(validation) {
        if (validation.valid) {
            return null;
        }

        return `❌ Ошибка: ${validation.error}`;
    }
}

module.exports = MinecraftValidator;
