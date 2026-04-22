#!/bin/bash

# ElizaOS Project Starter - Comprehensive Test Runner
# This script runs all test suites in the correct order

echo "========================================"
echo "ElizaOS Project Starter - Test Runner"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track overall status
ALL_TESTS_PASSED=true

# Function to run a test suite
run_test_suite() {
    local suite_name=$1
    local command=$2
    
    echo -e "${YELLOW}Running $suite_name...${NC}"
    echo "Command: $command"
    echo "----------------------------------------"
    
    if eval "$command"; then
        echo -e "${GREEN}✓ $suite_name passed${NC}"
        echo ""
    else
        echo -e "${RED}✗ $suite_name failed${NC}"
        echo ""
        ALL_TESTS_PASSED=false
    fi
}

# 1. TypeScript checks
run_test_suite "TypeScript checks" "bun run type-check"

# 2. Format checks
run_test_suite "Format checks" "bun run format:check"

# 3. Build project
run_test_suite "Build" "bun run build"

# 4. Unit tests
run_test_suite "Unit tests (Bun)" "bun run test:component"

# 5. E2E tests
run_test_suite "E2E tests (ElizaOS)" "bun run test:e2e"

# Summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"

if [ "$ALL_TESTS_PASSED" = true ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    echo "Please check the output above for details."
    exit 1
fi 
