const DatabaseManager = require('../managers/DatabaseManager');
const Logger = require('../utils/Logger');

async function test() {
    DatabaseManager.init();
    try {
        DatabaseManager.createOrder({
            id: 'TEST-DB-001',
            username: 'TestUserDB',
            amount: 10,
            description: 'Test Order via DB',
            status: 'pending'
        });
        console.log('Test order added');
    } catch (e) {
        console.error(e);
    }
}

test();
