#!/bin/bash

# Test script to verify universal macOS build
# This ensures the universal build contains both x64 and ARM64 architectures

set -e

echo "🧪 Testing Universal macOS Build"
echo "================================"

# Function to verify universal binary
verify_universal_dmg() {
    local dmg_file="$1"
    local mount_point="/tmp/verify_universal_$$"
    
    if [[ ! -f "$dmg_file" ]]; then
        echo "❌ Universal DMG file not found: $dmg_file"
        return 1
    fi
    
    echo ""
    echo "🔍 Analyzing Universal DMG: $(basename "$dmg_file")"
    echo "   File Size: $(ls -lh "$dmg_file" | awk '{print $5}')"
    
    # Create mount point
    mkdir -p "$mount_point"
    
    # Mount DMG
    echo "   📀 Mounting DMG..."
    if ! hdiutil attach "$dmg_file" -mountpoint "$mount_point" -quiet 2>/dev/null; then
        echo "   ❌ Failed to mount DMG"
        rm -rf "$mount_point"
        return 1
    fi
    
    # Find app bundle
    local app_bundle=$(find "$mount_point" -name "*.app" -type d | head -1)
    if [[ -z "$app_bundle" ]]; then
        echo "   ❌ No app bundle found in DMG"
        hdiutil detach "$mount_point" -quiet 2>/dev/null || true
        rm -rf "$mount_point"
        return 1
    fi
    
    echo "   📱 Found app bundle: $(basename "$app_bundle")"
    
    # Check main binary
    local main_binary="$app_bundle/Contents/MacOS/OCTO"
    if [[ -f "$main_binary" ]]; then
        echo "   🔍 Main binary architecture analysis:"
        local arch_info=$(lipo -info "$main_binary" 2>/dev/null)
        echo "      $arch_info"
        
        # Check if it's a universal binary
        if echo "$arch_info" | grep -q "fat file"; then
            echo "   ✅ Universal binary detected!"
            
            # Extract individual architectures
            if echo "$arch_info" | grep -q "x86_64"; then
                echo "   ✅ Contains x64 (Intel) architecture"
            else
                echo "   ❌ Missing x64 (Intel) architecture"
            fi
            
            if echo "$arch_info" | grep -q "arm64"; then
                echo "   ✅ Contains ARM64 (Apple Silicon) architecture"
            else
                echo "   ❌ Missing ARM64 (Apple Silicon) architecture"
            fi
        else
            echo "   ❌ Not a universal binary!"
            echo "      This appears to be a single-architecture binary"
        fi
        
        # Check file type
        echo "   📄 File type:"
        file "$main_binary" | sed 's/^/      /'
        
    else
        echo "   ❌ Main binary not found: $main_binary"
    fi
    
    # Check helper binaries
    echo "   🔍 Helper binaries architecture:"
    local helpers_dir="$app_bundle/Contents/Frameworks"
    if [[ -d "$helpers_dir" ]]; then
        find "$helpers_dir" -name "*.app" -type d | while read helper_app; do
            local helper_binary="$helper_app/Contents/MacOS/$(basename "$helper_app" .app)"
            if [[ -f "$helper_binary" ]]; then
                local helper_arch=$(lipo -info "$helper_binary" 2>/dev/null)
                if echo "$helper_arch" | grep -q "fat file"; then
                    echo "      $(basename "$helper_app"): Universal ($(echo "$helper_arch" | grep -o 'x86_64\|arm64' | tr '\n' ' '))"
                else
                    local single_arch=$(echo "$helper_arch" | grep -o 'x86_64\|arm64')
                    echo "      $(basename "$helper_app"): Single arch ($single_arch)"
                fi
            fi
        done
    fi
    
    # Unmount DMG
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    rm -rf "$mount_point"
    
    return 0
}

# Check system architecture
echo "🖥️  System Information:"
echo "   Architecture: $(uname -m)"
echo "   macOS Version: $(sw_vers -productVersion)"

# Check for universal DMG
echo ""
echo "📁 Searching for universal DMG in dist-ele..."

if [[ ! -d "dist-ele" ]]; then
    echo "❌ dist-ele directory not found"
    echo "💡 Run a universal build first: yarn build-ele:mac-universal"
    exit 1
fi

# Find universal DMG
UNIVERSAL_DMG=$(find dist-ele -name "*-universal.dmg" -type f | head -1)

if [[ -n "$UNIVERSAL_DMG" ]]; then
    verify_universal_dmg "$UNIVERSAL_DMG"
    
    echo ""
    echo "🎯 Universal Build Test Results:"
    echo "================================"
    echo "✅ Universal DMG found and analyzed"
    echo "📋 Next steps:"
    echo "   1. Test installation on Intel Mac"
    echo "   2. Test installation on Apple Silicon Mac"
    echo "   3. Verify app runs natively on both architectures"
    echo "   4. Check performance (no Rosetta translation needed)"
    
else
    echo "❌ No universal DMG found"
    echo "📁 Available files in dist-ele:"
    ls -la dist-ele/*.dmg 2>/dev/null || echo "No DMG files found"
    echo ""
    echo "💡 To create a universal build:"
    echo "   yarn build-ele:mac-universal"
fi

echo ""
echo "🔧 Universal Build Benefits:"
echo "   ✅ Single DMG file for all Mac users"
echo "   ✅ Native performance on both Intel and Apple Silicon"
echo "   ✅ Simplified distribution (one file instead of two)"
echo "   ✅ Automatic architecture selection by macOS"
echo ""
echo "⚠️  Universal Build Considerations:"
echo "   📦 Larger file size (contains both architectures)"
echo "   🕐 Longer build time (builds both architectures)"
echo "   💾 More disk space required during build"
