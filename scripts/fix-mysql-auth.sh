#!/bin/bash

# This script configures MySQL to allow Node.js applications to connect as root
# Run with: sudo bash fix-mysql-auth.sh

echo "Configuring MySQL authentication for Node.js..."

sudo mysql -e "
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '';
FLUSH PRIVILEGES;
SELECT user, host, plugin FROM mysql.user WHERE user='root';
"

echo "MySQL root user configured for passwordless access via mysql_native_password"
echo "Node.js applications can now connect without sudo"
