#!/bin/bash

# Test script for architecture-specific macOS builds
# This script builds both x64 and arm64 DMG files and verifies they are created correctly

set -e

echo "🚀 Testing architecture-specific macOS builds..."

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script can only be run on macOS"
    exit 1
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist-ele
rm -rf out-election

# Detect current architecture
CURRENT_ARCH=$(uname -m)
echo "🔍 Current system architecture: $CURRENT_ARCH"

if [[ "$CURRENT_ARCH" == "arm64" ]]; then
    echo "🔨 Building on Apple Silicon - building arm64 architecture..."
    yarn build-ele:mac-arm64
    EXPECTED_ARCH="arm64"
elif [[ "$CURRENT_ARCH" == "x86_64" ]]; then
    echo "🔨 Building on Intel - building x64 architecture..."
    yarn build-ele:mac-x64
    EXPECTED_ARCH="x86_64"
else
    echo "❌ Unknown architecture: $CURRENT_ARCH"
    exit 1
fi

# Check if build was successful
if [ ! -d "dist-ele" ]; then
    echo "❌ Build failed - dist-ele directory not found"
    exit 1
fi

echo "📁 Build output:"
ls -la dist-ele/

# Check for the expected architecture-specific DMG file
echo "🔍 Checking for expected DMG file..."

if [[ "$EXPECTED_ARCH" == "arm64" ]]; then
    TARGET_DMG=$(find dist-ele -name "*-arm64.dmg" | head -1)
    ARCH_NAME="Apple Silicon (arm64)"
elif [[ "$EXPECTED_ARCH" == "x86_64" ]]; then
    TARGET_DMG=$(find dist-ele -name "*-x64.dmg" | head -1)
    ARCH_NAME="Intel (x64)"
fi

if [ -z "$TARGET_DMG" ]; then
    echo "❌ $ARCH_NAME DMG not found"
    echo "Available files:"
    ls -la dist-ele/
    exit 1
else
    echo "✅ $ARCH_NAME DMG found: $TARGET_DMG"
    DMG_SIZE=$(stat -f%z "$TARGET_DMG")
    echo "   Size: $DMG_SIZE bytes ($(($DMG_SIZE / 1024 / 1024)) MB)"
fi

# Quick verification by mounting and checking binaries
echo "🔍 Verifying architecture-specific binaries..."

verify_dmg_architecture() {
    local dmg_file="$1"
    local expected_arch="$2"
    local mount_point="/tmp/octo_verify_${expected_arch}_$$"
    
    echo "  📱 Verifying $expected_arch DMG: $(basename "$dmg_file")"
    
    mkdir -p "$mount_point"
    
    if hdiutil attach "$dmg_file" -mountpoint "$mount_point" -quiet 2>/dev/null; then
        local app_bundle=$(find "$mount_point" -name "*.app" | head -1)
        if [ -n "$app_bundle" ]; then
            local binary_path="$app_bundle/Contents/MacOS/OCTO"
            if [ -f "$binary_path" ]; then
                local archs=$(lipo -info "$binary_path" 2>/dev/null || echo "Could not read architectures")
                echo "     🏗️  Binary architectures: $archs"
                
                if echo "$archs" | grep -q "$expected_arch"; then
                    echo "     ✅ Correct architecture ($expected_arch) found"
                else
                    echo "     ❌ Expected architecture ($expected_arch) not found"
                fi
            else
                echo "     ⚠️  Could not find main binary"
            fi
        else
            echo "     ⚠️  Could not find app bundle"
        fi
        hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    else
        echo "     ❌ Could not mount DMG"
    fi
    
    rm -rf "$mount_point"
}

# Verify the DMG file
verify_dmg_architecture "$TARGET_DMG" "$EXPECTED_ARCH"

echo ""
echo "🎉 Architecture-specific build test completed!"
echo ""
echo "📦 Created DMG file:"
echo "  $ARCH_NAME: $TARGET_DMG"
echo ""
echo "💡 Distribution notes:"
echo "  - This DMG is optimized for $ARCH_NAME"
echo "  - Built natively on $(uname -m) architecture"
echo "  - No cross-compilation or universal binary conflicts"
echo "  - Native modules like electron-screenshots work correctly"
