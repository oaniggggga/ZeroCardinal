module.exports = {
    apps: [{
        name: "ZeroCardinal",
        script: "./index.js",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: "development",
        },
        env_production: {
            NODE_ENV: "production",
        },
        error_file: "./logs/pm2-error.log",
        out_file: "./logs/pm2-out.log",
        time: true
    }]
};
