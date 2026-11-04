module.exports = {
  apps: [
    {
      name: "apna-ustad-backend",
      script: "./dist/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      listen_timeout: 8000,
      kill_timeout: 10000, // wait 10s for graceful shutdown before forcefully killing
      env: {
        NODE_ENV: "production"
      },
      env_development: {
        NODE_ENV: "development"
      }
    }
  ]
};
