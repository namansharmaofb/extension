#!/bin/bash
# Quick script to check recorded flows in MySQL

echo "=== Checking Test Cases ==="
mysql -u root -e "USE test_recorder; SELECT id, name, created_at FROM test_cases ORDER BY created_at DESC LIMIT 10;" 2>/dev/null || echo "Error: Make sure MySQL is running and database exists"

echo ""
echo "=== Checking Steps for Latest Test Case ==="
mysql -u root -e "USE test_recorder; SELECT ts.step_order, ts.action, ts.selector, ts.value FROM test_steps ts JOIN test_cases tc ON ts.test_case_id = tc.id ORDER BY tc.created_at DESC, ts.step_order ASC LIMIT 20;" 2>/dev/null || echo "Error: Make sure MySQL is running and database exists"
