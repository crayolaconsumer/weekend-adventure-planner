#!/bin/bash
# Feature verification script for Claude
# Run: ./scripts/verify-feature.sh <feature-name>

set -e

FEATURE=$1

if [ -z "$FEATURE" ]; then
  echo "Usage: ./scripts/verify-feature.sh <feature-name>"
  echo "Example: ./scripts/verify-feature.sh NotificationBell"
  exit 1
fi

echo "=== Verifying feature: $FEATURE ==="
echo ""

# Check if component file exists
echo "1. Checking component file exists..."
COMPONENT_FILE=$(find src/components -name "*${FEATURE}*" 2>/dev/null | head -1)
if [ -n "$COMPONENT_FILE" ]; then
  echo "   ✓ Found: $COMPONENT_FILE"
else
  echo "   ✗ No component file found matching '$FEATURE'"
fi

# Check imports
echo ""
echo "2. Checking where component is imported..."
IMPORTS=$(grep -r "import.*${FEATURE}" src/ 2>/dev/null || true)
if [ -n "$IMPORTS" ]; then
  echo "$IMPORTS" | while read line; do echo "   ✓ $line"; done
else
  echo "   ✗ Component is not imported anywhere"
fi

# Check renders
echo ""
echo "3. Checking where component is rendered..."
RENDERS=$(grep -r "<${FEATURE}" src/ 2>/dev/null || true)
if [ -n "$RENDERS" ]; then
  echo "$RENDERS" | while read line; do echo "   ✓ $line"; done
else
  echo "   ✗ Component is not rendered anywhere (JSX tag not found)"
fi

# Check API endpoint
echo ""
echo "4. Checking related API endpoints..."
API_FILES=$(find api -name "*.js" 2>/dev/null | xargs grep -l -i "${FEATURE}" 2>/dev/null || true)
if [ -n "$API_FILES" ]; then
  echo "$API_FILES" | while read line; do echo "   ✓ $line"; done
else
  echo "   - No specific API files found (may not be needed)"
fi

# Check hooks
echo ""
echo "5. Checking related hooks..."
HOOKS=$(find src/hooks -name "*${FEATURE}*" 2>/dev/null || true)
if [ -n "$HOOKS" ]; then
  echo "$HOOKS" | while read line; do echo "   ✓ $line"; done
else
  echo "   - No specific hooks found (may not be needed)"
fi

# Build check
echo ""
echo "6. Running build..."
if npm run build > /dev/null 2>&1; then
  echo "   ✓ Build succeeded"
else
  echo "   ✗ Build failed"
fi

echo ""
echo "=== Verification complete ==="
