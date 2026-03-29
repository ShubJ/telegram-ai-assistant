module.exports = {
  apps: [
    {
      name: 'telegram-ai-assistant',
      script: 'npm',
      args: 'run start:prod',
      cwd: __dirname,
      node_args: '--experimental-specifier-resolution=node',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      // Disable PM2 logs — app handles its own file logging
      out_file: '/dev/null',
      error_file: '/dev/null',
      merge_logs: true,
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
