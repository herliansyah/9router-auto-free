/**
 * Scheduler installation module for 9router free sync.
 * Installs systemd user timers (preferred, Persistent=true) with crontab fallback.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

function writeSystemdUnit(unitsDir, name, content) {
  fs.mkdirSync(unitsDir, { recursive: true });
  fs.writeFileSync(path.join(unitsDir, name), content);
}

function removeLegacyCronLines(scriptPath) {
  try {
    const currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    const filtered = currentCrontab.split('\n')
      .filter(line => line.trim().length > 0)
      .filter(line => !(line.includes('9router-auto-free') || line.includes(scriptPath)));

    if (filtered.length === 0) {
      execSync('crontab -r 2>/dev/null');
      return;
    }
    execSync(`echo "${filtered.join('\n').replace(/"/g, '\"')}" | crontab -`);
  } catch {}
}

function installScheduler(options = {}) {
  console.log('[*] Installing scheduler (systemd timers preferred, cron fallback)...');
  const scriptPath = options.scriptPath || path.resolve(__dirname, 'sync.js');
  const benchPath = options.benchPath || path.join(path.dirname(scriptPath), 'update-benchmarks.js');
  const logPath = options.logPath || path.join(path.dirname(scriptPath), 'sync.log');
  const home = os.homedir();
  const unitsDir = path.join(home, '.config', 'systemd', 'user');

  const serviceUnit = `[Unit]
Description=9router free models daily full sync

[Service]
Type=oneshot
WorkingDirectory=${path.dirname(scriptPath)}
ExecStart=/usr/bin/node ${scriptPath}
`;

  const serviceTimer = `[Unit]
Description=Daily 00:05 full sync of free models into 9router

[Timer]
OnCalendar=*-*-* 00:05:00
Persistent=true
Unit=9router-auto-free.service

[Install]
WantedBy=timers.target
`;

  const watchdogService = `[Unit]
Description=9router free combo watchdog (intra-day quota re-check)

[Service]
Type=oneshot
WorkingDirectory=${path.dirname(scriptPath)}
ExecStart=/usr/bin/node ${scriptPath} --refresh
`;

  const watchdogTimer = `[Unit]
Description=Hourly watchdog re-test of free combos (quota demotion)

[Timer]
OnCalendar=*-*-* *:35:00
Persistent=true
Unit=9router-free-watchdog.service

[Install]
WantedBy=timers.target
`;

  const benchService = `[Unit]
Description=Weekly live coding-benchmark database update

[Service]
Type=oneshot
WorkingDirectory=${path.dirname(scriptPath)}
ExecStart=/usr/bin/node ${benchPath}
`;

  const benchTimer = `[Unit]
Description=Weekly benchmark update (Monday 04:17)

[Timer]
OnCalendar=Mon *-*-* 04:17:00
Persistent=true
Unit=9router-bench-update.service

[Install]
WantedBy=timers.target
`;

  // 1) Try systemd user timers
  if (fs.existsSync('/run/systemd/system') || fs.existsSync('/usr/bin/systemctl')) {
    try {
      writeSystemdUnit(unitsDir, '9router-auto-free.service', serviceUnit);
      writeSystemdUnit(unitsDir, '9router-auto-free.timer', serviceTimer);
      writeSystemdUnit(unitsDir, '9router-free-watchdog.service', watchdogService);
      writeSystemdUnit(unitsDir, '9router-free-watchdog.timer', watchdogTimer);
      writeSystemdUnit(unitsDir, '9router-bench-update.service', benchService);
      writeSystemdUnit(unitsDir, '9router-bench-update.timer', benchTimer);

      removeLegacyCronLines(scriptPath);

      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable --now 9router-auto-free.timer 9router-free-watchdog.timer 9router-bench-update.timer');

      let lingerNote = '';
      try {
        execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: 'ignore' });
      } catch {
        lingerNote = '\n    Note: could not enable linger; timers run while you are logged in.\n    Run `sudo loginctl enable-linger ' + os.userInfo().username + '` for boot-level persistence.';
      }

      console.log('[✓] systemd user timers installed:');
      console.log('    - 9router-auto-free.timer     daily 00:05 (full sync, Persistent=true)');
      console.log('    - 9router-free-watchdog.timer hourly :35   (--refresh quota watchdog)');
      console.log('    - 9router-bench-update.timer  Mon 04:17    (benchmark update)');
      console.log(`    Log file: ${logPath}${lingerNote}`);
      return;
    } catch (err) {
      console.warn(`[!] systemd installation failed (${String(err.message).split('\n')[0]}); falling back to crontab.`);
    }
  }

  // 2) Crontab fallback
  try {
    const lines = [
      '# Free Models Sync for 9router (installed by sync.js)',
      `5 0 * * * /usr/bin/node ${scriptPath} >> ${logPath} 2>&1`,
      `35 * * * * /usr/bin/node ${scriptPath} --refresh >> ${logPath} 2>&1`,
      `17 4 * * 1 /usr/bin/node ${benchPath} >> ${logPath} 2>&1`
    ];

    let currentCrontab = '';
    try { currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' }); } catch {}

    const filtered = currentCrontab.split('\n')
      .filter(line => !line.includes('9router-auto-free') && !line.includes(scriptPath))
      .filter(line => line.trim().length > 0);

    filtered.push(...lines);
    const newCrontab = filtered.join('\n') + '\n';
    execSync(`echo "${newCrontab.replace(/"/g, '\"')}" | crontab -`);

    console.log('[✓] Cron fallback installed:');
    console.log('    - daily 00:05 full sync');
    console.log('    - hourly :35 watchdog refresh (--refresh)');
    console.log('    - Monday 04:17 benchmark update');
    console.log(`    Log file: ${logPath}`);
  } catch (err) {
    console.error(`[X] Failed to install any scheduler: ${err.message}`);
    console.log("    You can manually add the schedules shown above to 'crontab -e'.");
  }
}

module.exports = { installScheduler, writeSystemdUnit, removeLegacyCronLines };
