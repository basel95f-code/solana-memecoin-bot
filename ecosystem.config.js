/**
 * PM2 Configuration for Solana Memecoin Bot
 * Production-grade process management with auto-restart, clustering, and monitoring
 */

module.exports = {
  apps: [
    {
      // ============================================
      // Main Bot Application
      // ============================================
      name: 'memecoin-bot',
      script: './apps/bot/dist/index.js',
      cwd: process.cwd(),
      
      // Execution mode
      instances: 1, // Single instance for bot (stateful)
      exec_mode: 'fork', // Fork mode (cluster not suitable for stateful bot)
      
      // Auto restart configuration
      autorestart: true,
      watch: false, // Don't watch files in production
      max_memory_restart: '1G', // Restart if memory exceeds 1GB
      
      // Restart delays
      min_uptime: '10s', // Consider app online after 10s
      max_restarts: 10, // Max restarts within 1 minute
      restart_delay: 4000, // Wait 4s before restart
      
      // Environment
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      
      // Logging
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true, // Prefix logs with timestamp
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Log rotation
      max_size: '100M', // Rotate logs at 100MB
      max_files: 10, // Keep 10 rotated files
      compress: true, // Compress rotated logs
      
      // Graceful shutdown
      kill_timeout: 5000, // Wait 5s for graceful shutdown
      wait_ready: true, // Wait for ready signal
      listen_timeout: 10000, // Timeout for listen
      shutdown_with_message: true,
      
      // Process monitoring
      merge_logs: true,
      combine_logs: true,
      
      // Advanced features
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
      
      // Health monitoring
      vizion: false, // Disable git metadata (not needed in production)
      
      // Crash analysis
      pmx: true,
      automation: false,
    },
    
    // ============================================
    // API Server (if separate from bot)
    // ============================================
    {
      name: 'memecoin-api',
      script: './apps/bot/dist/api/server.js',
      cwd: process.cwd(),
      
      // Clustering for API (stateless)
      instances: 2, // Run 2 instances
      exec_mode: 'cluster',
      
      // Auto restart
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      
      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      
      // Logging
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_file: './logs/api-combined.log',
      time: true,
      
      // Log rotation
      max_size: '50M',
      max_files: 5,
      compress: true,
      
      // Graceful shutdown
      kill_timeout: 3000,
      wait_ready: true,
      listen_timeout: 5000,
      
      // Health check
      health_check: {
        enable: true,
        endpoint: 'http://localhost:3000/health',
        interval: 30000, // 30 seconds
        timeout: 5000,
      },
    },
  ],
  
  // ============================================
  // PM2 Deploy Configuration (optional)
  // ============================================
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:youruser/solana-memecoin-bot.git',
      path: '/var/www/memecoin-bot',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'sudo apt-get install git -y',
    },
  },
};
