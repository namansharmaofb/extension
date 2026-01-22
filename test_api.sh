#!/bin/bash
# Test the backend API endpoints

echo "=== Testing GET /api/test-cases (list all) ==="
curl -s http://localhost:7080/api/test-cases | python3 -m json.tool 2>/dev/null || curl -s http://localhost:7080/api/test-cases

echo ""
echo ""
echo "=== If you have a test case ID, test GET /api/test-cases/:id ==="
echo "Example: curl http://localhost:7080/api/test-cases/1"
