#!/bin/bash

# Get the absolute path to the runner script
RUNNER_PATH=$(realpath scripts/e2e/runner.js)
PWD_PATH=$(pwd)

# Create the cron entry (9 AM daily)
CRON_ENTRY="0 9 * * * /usr/bin/node $RUNNER_PATH >> $PWD_PATH/scripts/e2e/e2e-cron.log 2>&1"

# Check if it already exists
(crontab -l 2>/dev/null | grep -F "$RUNNER_PATH") || (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "E2E Schedule set: Daily at 9 AM"
echo "Log file: $PWD_PATH/scripts/e2e/e2e-cron.log"
