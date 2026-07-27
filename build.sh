#!/bin/sh
echo "=== FILES AT ROOT ==="
ls -la _worker.js 2>&1 || echo "WORKER NOT FOUND"
echo "=== BUILDING ==="
npx quartz plugin install
npx quartz build
echo "=== COPYING WORKER ==="
cp _worker.js public/ 2>&1 || echo "COPY FAILED"
echo "=== PUBLIC CONTENTS ==="
ls -la public/_worker.js 2>&1 || echo "WORKER NOT IN PUBLIC"
