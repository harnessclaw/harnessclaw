#!/bin/bash
# Ensures environment readiness for agent operations
if [ ! -d "node_modules" ]; then
    echo "Warning: node_modules not found. Running yarn install..."
    yarn install
fi
echo "HarnessClaw environment verified."
