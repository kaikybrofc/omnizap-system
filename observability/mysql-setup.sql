-- OmniZap observability setup for MySQL
-- Adjust usernames/passwords before running.

-- 1) Exporter user (metrics)
CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY 'exporter';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';
GRANT SELECT ON performance_schema.* TO 'exporter'@'%';
GRANT SELECT ON information_schema.* TO 'exporter'@'%';
GRANT SELECT ON sys.* TO 'exporter'@'%';
FLUSH PRIVILEGES;

-- 2) Slow query log (runtime)
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.5;
SET GLOBAL log_output = 'FILE';
-- Adjust path to match your MySQL log directory
SET GLOBAL slow_query_log_file = '/var/log/mysql/mysql-slow.log';

-- 3) Performance Schema (runtime)
-- Ensure it is enabled in my.cnf for persistence
SET GLOBAL performance_schema = ON;

-- Enable statement instruments/consumers
UPDATE performance_schema.setup_instruments
  SET ENABLED = 'YES', TIMED = 'YES'
  WHERE NAME LIKE 'statement/%';

UPDATE performance_schema.setup_consumers
  SET ENABLED = 'YES'
  WHERE NAME IN (
    'events_statements_current',
    'events_statements_history',
    'events_statements_history_long',
    'events_waits_current',
    'events_waits_history',
    'events_waits_history_long'
  );

-- 4) InnoDB metrics
SET GLOBAL innodb_monitor_enable = 'all';
SET GLOBAL innodb_status_output = ON;
SET GLOBAL innodb_status_output_locks = ON;

-- Optional: log deadlocks to error log
SET GLOBAL innodb_print_all_deadlocks = ON;
