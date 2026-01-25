/**
 * PM2 Ecosystem Configuration for Solana Memecoin Bot
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart ecosystem.config.js
 *   pm2 stop ecosystem.config.js
 *   pm2 logs solana-memecoin-bot
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      // Application Configuration
      name: 'solana-memecoin-bot',
      script: './apps/bot/dist/index.js',
      cwd: './',
      
      // Instances & Execution Mode
      instances: 1,  // Single instance (not cluster) - bot needs single state
      exec_mode: 'fork',  // Fork mode for stateful applications
      
      // Environment Variables
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      
      // Auto-restart Configuration
      autorestart: true,
      max_restarts: 10,  // Max restarts within min_uptime before considering unstable
      min_uptime: '10s',  // Minimum uptime before considering stable
      restart_delay: 4000,  // Delay between restarts (ms)
      
      // Memory & Performance
      max_memory_restart: '1G',  // Restart if memory exceeds 1GB
      
      // Logging Configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      merge_logs: true,  // Merge logs from all instances
      
      // Log Rotation (requires pm2-logrotate module)
      // Install with: pm2 install pm2-logrotate
      // Configure with: pm2 set pm2-logrotate:max_size 10M
      
      // Process Management
      kill_timeout: 5000,  // Time to wait for graceful shutdown (ms)
      listen_timeout: 3000,  // Time to wait for app to listen (ms)
      shutdown_with_message: true,  // Send shutdown message to process
      
      // Watch & Reload (disabled in production)
      watch: false,  // Set to true in development if desired
      ignore_watch: [
        'node_modules',
        'logs',
        'data',
        '*.log',
        '.git',
      ],
      
      // Advanced Features
      exp_backoff_restart_delay: 100,  // Exponential backoff for restarts
      
      // Source Map Support (for better error traces)
      source_map_support: true,
      
      // Interpreter (Node.js)
      interpreter: 'node',
      interpreter_args: '--max-old-space-size=1024',  // Node.js heap size limit
      
      // Cron Restart (optional - restart daily at 3 AM)
      // cron_restart: '0 3 * * *',
      
      // Error Handling
      error: './logs/pm2-error.log',
      out: './logs/pm2-out.log',
      
      // Graceful Shutdown
      wait_ready: false,  // Wait for process.send('ready')
      
      // Combined Logs
      combine_logs: true,
      
      // Timezone
      time: true,
    },
  ],

  /**
   * PM2 Deploy Configuration (Optional)
   * Uncomment and configure for deployment automation
   */
  // deploy: {
  //   production: {
  //     user: 'node',
  //     host: 'your-server.com',
  //     ref: 'origin/main',
  //     repo: 'git@github.com:username/solana-memecoin-bot.git',
  //     path: '/var/www/solana-memecoin-bot',
  //     'pre-deploy-local': '',
  //     'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
  //     'pre-setup': '',
  //   },
  // },
};
