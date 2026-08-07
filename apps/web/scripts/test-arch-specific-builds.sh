#!/bin/bash

# Test script to verify architecture-specific builds work correctly
# This ensures each build command only produces its target architecture

set -e

echo "🧪 Testing Architecture-Specific Builds"
echo "======================================="

# Function to check what files exist in dist-ele
check_dist_ele() {
    local build_type="$1"
    echo ""
    echo "📁 Files in dist-ele after $build_type build:"
    if [[ -d "dist-ele" ]]; then
        ls -la dist-ele/*.dmg 2>/dev/null || echo "  No DMG files found"
        ls -la dist-ele/*.zip 2>/dev/null || echo "  No ZIP files found"
    else
        echo "  dist-ele directory does not exist"
    fi
}

# Function to verify architecture of DMG
verify_dmg_architecture() {
    local dmg_file="$1"
    local expected_arch="$2"
    local mount_point="/tmp/verify_$$"
    
    echo "🔍 Verifying $dmg_file for $expected_arch architecture..."
    
    mkdir -p "$mount_point"
    if hdiutil attach "$dmg_file" -mountpoint "$mount_point" -quiet 2>/dev/null; then
        local app_bundle=$(find "$mount_point" -name "*.app" -type d | head -1)
        if [[ -n "$app_bundle" ]]; then
            local binary="$app_bundle/Contents/MacOS/OCTO"
            if [[ -f "$binary" ]]; then
                local arch_info=$(lipo -info "$binary" 2>/dev/null)
                echo "  Architecture: $arch_info"
                
                if echo "$arch_info" | grep -q "$expected_arch"; then
                    echo "  ✅ Correct architecture ($expected_arch) found"
                    return 0
                else
                    echo "  ❌ Expected $expected_arch but found different architecture"
                    return 1
                fi
            else
                echo "  ❌ Binary not found in app bundle"
                return 1
            fi
        else
            echo "  ❌ App bundle not found in DMG"
            return 1
        fi
    else
        echo "  ❌ Could not mount DMG"
        return 1
    fi
    
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    rm -rf "$mount_point"
}

echo "🧹 Starting with clean slate..."
yarn clean:dist-ele

echo ""
echo "🔨 Test 1: Building x64 architecture only"
echo "=========================================="
yarn build-ele:mac-x64

check_dist_ele "x64"

# Verify only x64 files exist
X64_DMG=$(find dist-ele -name "*-x64.dmg" 2>/dev/null | head -1)
ARM64_DMG=$(find dist-ele -name "*-arm64.dmg" 2>/dev/null | head -1)

if [[ -n "$X64_DMG" ]]; then
    echo "✅ x64 DMG found: $(basename "$X64_DMG")"
    verify_dmg_architecture "$X64_DMG" "x86_64"
else
    echo "❌ x64 DMG not found"
    exit 1
fi

if [[ -n "$ARM64_DMG" ]]; then
    echo "❌ FAIL: ARM64 DMG found when building x64 only: $(basename "$ARM64_DMG")"
    exit 1
else
    echo "✅ No ARM64 DMG found (correct for x64-only build)"
fi

echo ""
echo "🧹 Cleaning for next test..."
yarn clean:dist-ele

echo ""
echo "🔨 Test 2: Building ARM64 architecture only"
echo "============================================"
yarn build-ele:mac-arm64

check_dist_ele "ARM64"

# Verify only ARM64 files exist
X64_DMG=$(find dist-ele -name "*-x64.dmg" 2>/dev/null | head -1)
ARM64_DMG=$(find dist-ele -name "*-arm64.dmg" 2>/dev/null | head -1)

if [[ -n "$ARM64_DMG" ]]; then
    echo "✅ ARM64 DMG found: $(basename "$ARM64_DMG")"
    verify_dmg_architecture "$ARM64_DMG" "arm64"
else
    echo "❌ ARM64 DMG not found"
    exit 1
fi

if [[ -n "$X64_DMG" ]]; then
    echo "❌ FAIL: x64 DMG found when building ARM64 only: $(basename "$X64_DMG")"
    exit 1
else
    echo "✅ No x64 DMG found (correct for ARM64-only build)"
fi

echo ""
echo "🎉 All Tests Passed!"
echo "===================="
echo "✅ x64 build produces only x64 files"
echo "✅ ARM64 build produces only ARM64 files"
echo "✅ No cross-contamination between builds"
echo "✅ Architecture verification successful"

echo ""
echo "📦 Final verification - building both architectures separately:"
echo ""

echo "🔨 Building x64..."
yarn build-ele:mac-x64
X64_DMG=$(find dist-ele -name "*-x64.dmg" 2>/dev/null | head -1)
echo "  Created: $(basename "$X64_DMG")"

echo "🔨 Building ARM64..."
yarn build-ele:mac-arm64
ARM64_DMG=$(find dist-ele -name "*-arm64.dmg" 2>/dev/null | head -1)
echo "  Created: $(basename "$ARM64_DMG")"

echo ""
echo "📁 Final dist-ele contents:"
ls -la dist-ele/*.dmg dist-ele/*.zip 2>/dev/null || echo "No files found"

echo ""
echo "🎯 Architecture-specific builds are working correctly!"
echo "   Use 'yarn build-ele:mac-x64' for Intel Macs"
echo "   Use 'yarn build-ele:mac-arm64' for Apple Silicon Macs"
